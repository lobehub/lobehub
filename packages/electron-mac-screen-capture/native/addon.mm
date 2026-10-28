// ScreenCaptureKit stills for the capture overlay.
//
// The previous path went through `CGWindowListCreateImage`, which Apple
// obsoleted in macOS 15 — using it can raise system alerts about "collecting
// detailed information about the user" (macOS Sequoia 15 release notes), and it
// is the legacy API ScreenCaptureKit replaced. `SCShareableContent` supplies the
// window and display list and `SCScreenshotManager` the images; both work at
// native pixel resolution and honour a permission grant in the running process.
//
// SCK talks through completion handlers, so the two calls the JS side needs
// synchronously (status, enumeration) are bridged with a semaphore, and the
// image calls run on a worker thread because a 5K display takes a while.

#include <napi.h>
#include <cmath>
#include <functional>

#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <ImageIO/ImageIO.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>

static const int64_t kQueryTimeout = 5 * NSEC_PER_SEC;
static const int64_t kCaptureTimeout = 20 * NSEC_PER_SEC;

static BOOL ShareableContentAvailable(void) {
  if (@available(macOS 12.3, *)) return NSClassFromString(@"SCShareableContent") != nil;
  return NO;
}

static BOOL ScreenshotsAvailable(void) {
  if (@available(macOS 14.0, *)) return NSClassFromString(@"SCScreenshotManager") != nil;
  return NO;
}

static NSError *MakeError(NSString *message) {
  return [NSError errorWithDomain:@"LobeScreenCapture"
                             code:1
                         userInfo:@{NSLocalizedDescriptionKey : message}];
}

// Callers have to tell "the user has not allowed direct capture yet" apart from
// "there is nothing to capture" and from a plain failure: the first is a system
// dialog the user can still accept, the others are not. The callback drops its
// NSError far too easily, so it is mapped here instead of being discarded.
static NSString *ReasonForError(NSError *error) {
  if (!error) return @"failed";
  if ([error.domain isEqualToString:@"LobeScreenCapture"]) return @"timeout";
  if ([error.domain isEqualToString:SCStreamErrorDomain]) {
    switch (error.code) {
      case SCStreamErrorUserDeclined:
        return @"denied";
      case SCStreamErrorNoWindowList:
      case SCStreamErrorNoDisplayList:
      case SCStreamErrorNoCaptureSource:
        return @"not-found";
      case SCStreamErrorNotSupported:
        return @"unsupported";
      default:
        return @"failed";
    }
  }
  return @"failed";
}

// The selector is the only way to reach `SCShareableContent` synchronously; a
// timeout reads as "no answer" rather than as a denied permission.
static SCShareableContent *FetchShareableContent(NSError **outError) {
  if (!ShareableContentAvailable()) {
    if (outError) *outError = MakeError(@"ScreenCaptureKit needs macOS 12.3 or newer");
    return nil;
  }

  __block SCShareableContent *content = nil;
  __block NSError *failure = nil;
  dispatch_semaphore_t answered = dispatch_semaphore_create(0);
  [SCShareableContent
      getShareableContentExcludingDesktopWindows:NO
                             onScreenWindowsOnly:YES
                               completionHandler:^(SCShareableContent *result, NSError *error) {
                                 content = result;
                                 failure = error;
                                 dispatch_semaphore_signal(answered);
                               }];

  if (dispatch_semaphore_wait(answered, dispatch_time(DISPATCH_TIME_NOW, kQueryTimeout)) != 0) {
    if (outError) *outError = MakeError(@"ScreenCaptureKit did not answer in time");
    return nil;
  }
  if (outError) *outError = failure;
  return content;
}

// `SCDisplay.width` counts the same points as its frame, so the backing scale
// has to come from the display mode: its pixel width is the framebuffer the
// capture should run at, and its point width is what the renderer lays out in.
// Electron reports the same ratio as `screen.scaleFactor`.
static CGFloat ScaleFactorForDisplay(SCDisplay *display) {
  if (!display) return 1;
  CGDisplayModeRef mode = CGDisplayCopyDisplayMode(display.displayID);
  if (!mode) return 1;
  size_t pixelWidth = CGDisplayModeGetPixelWidth(mode);
  size_t pointWidth = CGDisplayModeGetWidth(mode);
  CGDisplayModeRelease(mode);
  if (pixelWidth == 0 || pointWidth == 0) return 1;
  return (CGFloat)pixelWidth / (CGFloat)pointWidth;
}

static SCDisplay *DisplayForFrame(NSArray<SCDisplay *> *displays, CGRect frame) {
  CGPoint center = CGPointMake(CGRectGetMidX(frame), CGRectGetMidY(frame));
  SCDisplay *best = nil;
  CGFloat bestArea = 0;
  for (SCDisplay *display in displays) {
    if (CGRectContainsPoint(display.frame, center)) return display;
    CGRect overlap = CGRectIntersection(display.frame, frame);
    CGFloat area = CGRectIsNull(overlap) ? 0 : overlap.size.width * overlap.size.height;
    if (area > bestArea) {
      bestArea = area;
      best = display;
    }
  }
  return best ?: displays.firstObject;
}

static NSData *PngFromImage(CGImageRef image) {
  if (!image) return nil;
  NSMutableData *data = [NSMutableData data];
  CGImageDestinationRef destination =
      CGImageDestinationCreateWithData((__bridge CFMutableDataRef)data, CFSTR("public.png"), 1, NULL);
  if (!destination) return nil;
  CGImageDestinationAddImage(destination, image, NULL);
  BOOL finished = CGImageDestinationFinalize(destination);
  CFRelease(destination);
  return finished ? data : nil;
}

static NSData *CaptureImage(SCContentFilter *filter,
                            SCStreamConfiguration *configuration,
                            NSString **outReason) {
  if (!ScreenshotsAvailable()) {
    if (outReason) *outReason = @"unsupported";
    return nil;
  }

  __block CGImageRef captured = NULL;
  __block NSError *failure = nil;
  dispatch_semaphore_t answered = dispatch_semaphore_create(0);
  if (@available(macOS 14.0, *)) {
    [SCScreenshotManager
        captureImageWithFilter:filter
                 configuration:configuration
             completionHandler:^(CGImageRef image, NSError *error) {
               if (image) captured = CGImageRetain(image);
               failure = error;
               dispatch_semaphore_signal(answered);
             }];
  } else {
    if (outReason) *outReason = @"unsupported";
    return nil;
  }

  if (dispatch_semaphore_wait(answered, dispatch_time(DISPATCH_TIME_NOW, kCaptureTimeout)) != 0) {
    if (outReason) *outReason = @"timeout";
    return nil;
  }
  NSData *png = PngFromImage(captured);
  if (captured) CGImageRelease(captured);
  if (!png && outReason) *outReason = ReasonForError(failure);
  return png;
}

// One window at native pixel resolution, including any part of it that is off
// screen: `desktopIndependentWindow` is not clipped to the display.
static NSData *CaptureWindowImage(CGWindowID windowId, NSString **outReason) {
  NSError *error = nil;
  SCShareableContent *content = FetchShareableContent(&error);
  if (!content) {
    if (outReason) *outReason = ReasonForError(error);
    return nil;
  }

  SCWindow *target = nil;
  for (SCWindow *window in content.windows) {
    if (window.windowID == windowId) {
      target = window;
      break;
    }
  }
  if (!target) {
    // The window closed between enumeration and the capture.
    if (outReason) *outReason = @"not-found";
    return nil;
  }

  CGFloat scale = ScaleFactorForDisplay(DisplayForFrame(content.displays, target.frame));
  SCStreamConfiguration *configuration = [SCStreamConfiguration new];
  configuration.width = (size_t)MAX(1, lround(target.frame.size.width * scale));
  configuration.height = (size_t)MAX(1, lround(target.frame.size.height * scale));
  configuration.showsCursor = NO;

  SCContentFilter *filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:target];
  return CaptureImage(filter, configuration, outReason);
}

// A region given in global points, the unit the overlay lays out in. The crop
// happens in SCK, so the result is native resolution rather than a cropped
// downscale.
static NSData *CaptureRectImage(CGRect rect, NSString **outReason) {
  if (rect.size.width < 1 || rect.size.height < 1) {
    if (outReason) *outReason = @"failed";
    return nil;
  }

  NSError *error = nil;
  SCShareableContent *content = FetchShareableContent(&error);
  if (!content) {
    if (outReason) *outReason = ReasonForError(error);
    return nil;
  }

  SCDisplay *display = DisplayForFrame(content.displays, rect);
  if (!display) {
    if (outReason) *outReason = @"not-found";
    return nil;
  }

  CGFloat scale = ScaleFactorForDisplay(display);
  CGRect local = CGRectMake(rect.origin.x - display.frame.origin.x,
                            rect.origin.y - display.frame.origin.y, rect.size.width,
                            rect.size.height);
  SCStreamConfiguration *configuration = [SCStreamConfiguration new];
  configuration.sourceRect = local;
  configuration.width = (size_t)MAX(1, lround(local.size.width * scale));
  configuration.height = (size_t)MAX(1, lround(local.size.height * scale));
  configuration.showsCursor = NO;

  SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:display excludingWindows:@[]];
  return CaptureImage(filter, configuration, outReason);
}

class CaptureWorker : public Napi::AsyncWorker {
 public:
  CaptureWorker(Napi::Env env, std::function<NSData *(NSString **)> capture)
      : Napi::AsyncWorker(env),
        deferred_(Napi::Promise::Deferred::New(env)),
        capture_(std::move(capture)) {}

  Napi::Promise Promise() const { return deferred_.Promise(); }

  void Execute() override {
    @autoreleasepool {
      // The out-parameter is autoreleasing, so the holder has to be too: ARC
      // refuses to hand a strong ivar's address to a write-back argument.
      __autoreleasing NSString *reason = nil;
      payload_ = capture_(&reason);
      reason_ = reason;
    }
  }

  void OnOK() override {
    Napi::Env env = Env();
    Napi::Object outcome = Napi::Object::New(env);
    // The reason travels with the image: "the user has not allowed direct
    // capture yet" has to reach the caller, which is the only place that knows
    // whether the permission itself is granted.
    if (payload_) {
      outcome.Set("png", Napi::Buffer<uint8_t>::Copy(env, (const uint8_t *)payload_.bytes,
                                                     (size_t)payload_.length));
    } else {
      outcome.Set("png", env.Null());
    }
    outcome.Set("reason", reason_ ? Napi::String::New(env, reason_.UTF8String) : env.Null());
    deferred_.Resolve(outcome);
  }

  void OnError(const Napi::Error &error) override { deferred_.Reject(error.Value()); }

 private:
  Napi::Promise::Deferred deferred_;
  std::function<NSData *(NSString **)> capture_;
  NSData *payload_ = nil;
  NSString *reason_ = nil;
};

static Napi::Value IsSupported(const Napi::CallbackInfo &info) {
  return Napi::Boolean::New(info.Env(), ScreenshotsAvailable());
}

// The JS side asks whether the screen is on before touching the screen at all:
// an unresolved permission must not raise the system prompt.
static Napi::Value ProbePermission(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  NSError *error = nil;
  SCShareableContent *content = FetchShareableContent(&error);
  if (content) return Napi::String::New(env, "granted");

  // The system prompt and the toggle both end in this error once the user
  // declines; everything else is "no answer", which must not read as a denial.
  if (error && [error.domain isEqualToString:SCStreamErrorDomain] &&
      error.code == SCStreamErrorUserDeclined) {
    return Napi::String::New(env, "denied");
  }
  return Napi::String::New(env, "unknown");
}

static Napi::Value ShareableContent(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  NSError *error = nil;
  SCShareableContent *content = FetchShareableContent(&error);
  if (!content) {
    return Napi::String::New(env, "null");
  }

  NSMutableArray *displays = [NSMutableArray arrayWithCapacity:content.displays.count];
  CGFloat primaryHeight = NSScreen.screens.firstObject.frame.size.height;
  for (SCDisplay *display in content.displays) {
    [displays addObject:@{
      @"displayID" : @(display.displayID),
      @"frame" : @{
        @"height" : @(display.frame.size.height),
        @"width" : @(display.frame.size.width),
        @"x" : @(display.frame.origin.x),
        @"y" : @(display.frame.origin.y),
      },
      @"isPrimary" : @(CGRectGetMinY(display.frame) == 0 && CGRectGetMinX(display.frame) == 0),
      @"scaleFactor" : @(ScaleFactorForDisplay(display)),
    }];
  }
  (void)primaryHeight;

  NSMutableArray *windows = [NSMutableArray arrayWithCapacity:content.windows.count];
  for (SCWindow *window in content.windows) {
    SCRunningApplication *owner = window.owningApplication;
    [windows addObject:@{
      @"appName" : owner.applicationName ?: @"",
      @"bundleId" : owner.bundleIdentifier ?: @"",
      @"frame" : @{
        @"height" : @(window.frame.size.height),
        @"width" : @(window.frame.size.width),
        @"x" : @(window.frame.origin.x),
        @"y" : @(window.frame.origin.y),
      },
      @"isOnScreen" : @(window.isOnScreen),
      @"layer" : @(window.windowLayer),
      @"pid" : @(owner.processID),
      @"title" : window.title ?: @"",
      @"windowID" : @(window.windowID),
    }];
  }

  NSDictionary *payload = @{@"displays" : displays, @"windows" : windows};
  NSError *serializationError = nil;
  NSData *json = [NSJSONSerialization dataWithJSONObject:payload options:0 error:&serializationError];
  if (!json) return Napi::String::New(env, "null");
  std::string text((const char *)json.bytes, json.length);
  return Napi::String::New(env, text);
}

static Napi::Value CaptureWindow(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "captureWindow needs a window id").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto windowId = (CGWindowID)info[0].As<Napi::Number>().Uint32Value();
  auto *worker = new CaptureWorker(
      env, [windowId](NSString **reason) -> NSData * { return CaptureWindowImage(windowId, reason); });
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

static Napi::Value CaptureRect(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) {
    Napi::TypeError::New(env, "captureRect needs a rect").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  Napi::Object rect = info[0].As<Napi::Object>();
  CGRect frame = CGRectMake(rect.Get("x").ToNumber().DoubleValue(),
                            rect.Get("y").ToNumber().DoubleValue(),
                            rect.Get("width").ToNumber().DoubleValue(),
                            rect.Get("height").ToNumber().DoubleValue());
  auto *worker = new CaptureWorker(
      env, [frame](NSString **reason) -> NSData * { return CaptureRectImage(frame, reason); });
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("captureRect", Napi::Function::New(env, CaptureRect));
  exports.Set("captureWindow", Napi::Function::New(env, CaptureWindow));
  exports.Set("isSupported", Napi::Function::New(env, IsSupported));
  exports.Set("probePermission", Napi::Function::New(env, ProbePermission));
  exports.Set("shareableContent", Napi::Function::New(env, ShareableContent));
  return exports;
}

NODE_API_MODULE(lobehub_mac_screen_capture, Init)
