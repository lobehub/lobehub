#include <napi.h>

#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <QuartzCore/QuartzCore.h>

static NSString *const kSettingsBundleId = @"com.apple.systempreferences";
static const CGFloat kPanelWidth = 380;
static const CGFloat kPanelHeight = 56;
static const CGFloat kCornerRadius = 14;
static const CGFloat kAccessorySize = 32;
static const NSRect kAccessoryFrame = {{16, 12}, {kAccessorySize, kAccessorySize}};
static const NSRect kHintFrame = {{8, 2}, {52, 52}};
static const CGFloat kTextX = 64;

// Closed-form damped spring from 0 to 1 (unit mass), parameterized the way
// SwiftUI's spring(response:dampingFraction:) is, so values can be tuned
// against familiar system motion.
typedef struct {
  double omega;
  double zeta;
  double velocity;
} LobeSpring;

static LobeSpring SpringMake(double response, double dampingFraction, double velocity) {
  return (LobeSpring){2 * M_PI / response, dampingFraction, velocity};
}

static double SpringValue(LobeSpring spring, double t) {
  double decay = spring.zeta * spring.omega;
  if (spring.zeta < 1) {
    double damped = spring.omega * sqrt(1 - spring.zeta * spring.zeta);
    double sine = (spring.velocity - decay) / damped;
    return 1 + exp(-decay * t) * (-cos(damped * t) + sine * sin(damped * t));
  }
  return 1 + exp(-spring.omega * t) * (-1 + (spring.velocity - spring.omega) * t);
}

static double SpringSettleTime(LobeSpring spring, double tolerance) {
  return log(1 / tolerance) / (spring.zeta * spring.omega);
}

static Napi::ThreadSafeFunction gEventTsfn;
static bool gEventTsfnActive = false;

static void EmitEvent(NSDictionary *payload) {
  if (!gEventTsfnActive) return;
  NSError *error = nil;
  NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:&error];
  if (!data) return;
  std::string json((const char *)data.bytes, data.length);
  gEventTsfn.NonBlockingCall(
      [json](Napi::Env env, Napi::Function cb) { cb.Call({Napi::String::New(env, json)}); });
}

static void RunOnMain(dispatch_block_t block) {
  if ([NSThread isMainThread]) {
    block();
  } else {
    dispatch_sync(dispatch_get_main_queue(), block);
  }
}

static NSString *StringValue(NSDictionary *state, NSString *key) {
  id value = state[key];
  return [value isKindOfClass:[NSString class]] ? value : @"";
}

static double NumberValue(NSDictionary *state, NSString *key, double fallback) {
  id value = state[key];
  return [value isKindOfClass:[NSNumber class]] ? [value doubleValue] : fallback;
}

@interface LobeSettingsWindow : NSObject
@property (nonatomic, assign) uint32_t number;
@property (nonatomic, assign) CGRect bounds;
@property (nonatomic, copy) NSString *title;
@end

@implementation LobeSettingsWindow
@end

static NSArray<LobeSettingsWindow *> *SettingsWindows() {
  NSArray<NSRunningApplication *> *apps =
      [NSRunningApplication runningApplicationsWithBundleIdentifier:kSettingsBundleId];
  if (apps.count == 0) return @[];
  NSMutableSet<NSNumber *> *pids = [NSMutableSet set];
  for (NSRunningApplication *app in apps) [pids addObject:@(app.processIdentifier)];

  CFArrayRef list = CGWindowListCopyWindowInfo(
      kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID);
  if (!list) return @[];

  NSMutableArray<LobeSettingsWindow *> *windows = [NSMutableArray array];
  for (NSDictionary *info in (__bridge NSArray *)list) {
    if (![pids containsObject:info[(id)kCGWindowOwnerPID]]) continue;
    if ([info[(id)kCGWindowLayer] intValue] != 0) continue;
    CGRect bounds;
    if (!CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)info[(id)kCGWindowBounds],
                                                &bounds)) {
      continue;
    }
    LobeSettingsWindow *window = [LobeSettingsWindow new];
    window.number = [info[(id)kCGWindowNumber] unsignedIntValue];
    window.bounds = bounds;
    // Window titles of other apps are only readable with Screen Recording.
    id title = info[(id)kCGWindowName];
    window.title = [title isKindOfClass:[NSString class]] ? title : nil;
    [windows addObject:window];
  }
  CFRelease(list);
  return windows;
}

static BOOL IsMainWindowCandidate(LobeSettingsWindow *window) {
  return window.bounds.size.width >= 300 && window.bounds.size.height >= 200;
}

// The Touch ID / password prompt and the file chooser open as separate
// Settings windows centered over the main one; search popovers are not.
static BOOL IsPromptWindow(LobeSettingsWindow *window, LobeSettingsWindow *main) {
  return window.number != main.number && window.bounds.size.width >= 200 &&
         window.bounds.size.height >= 150 &&
         fabs(CGRectGetMidX(window.bounds) - CGRectGetMidX(main.bounds)) <= 24;
}

static NSRect CocoaRectFromWindowBounds(CGRect bounds) {
  CGFloat primaryHeight = NSScreen.screens.firstObject.frame.size.height;
  return NSMakeRect(bounds.origin.x, primaryHeight - CGRectGetMaxY(bounds), bounds.size.width,
                    bounds.size.height);
}

static NSRect PanelFrameForSettingsWindow(CGRect bounds, CGFloat sidebarWidth, CGFloat bottomInset) {
  // CGWindowList bounds are top-left based on the primary display, while
  // NSWindow frames are bottom-left based on the same display. Flipping with
  // the window's own screen misplaces the panel on secondary displays.
  CGFloat primaryHeight = NSScreen.screens.firstObject.frame.size.height;
  CGFloat bottom = primaryHeight - CGRectGetMaxY(bounds);
  CGFloat contentWidth = bounds.size.width - sidebarWidth;
  CGFloat x = sidebarWidth > 0 && contentWidth >= kPanelWidth + 32
                  ? bounds.origin.x + sidebarWidth + (contentWidth - kPanelWidth) / 2
                  : bounds.origin.x + (bounds.size.width - kPanelWidth) / 2;
  return NSMakeRect(round(x), round(bottom + bottomInset), kPanelWidth, kPanelHeight);
}

static BOOL ShouldShowAlongside(NSRunningApplication *front) {
  NSString *bundleId = front.bundleIdentifier;
  if (!bundleId) return NO;
  // Adding an app to a privacy list raises Touch ID / password UI owned by
  // these agents; the panel must stay up to tell the user to confirm there.
  return [bundleId isEqualToString:kSettingsBundleId] ||
         [bundleId isEqualToString:@"com.apple.SecurityAgent"] ||
         [bundleId isEqualToString:@"com.apple.LocalAuthentication.UIAgent"];
}

@interface LobeGuidePanel : NSPanel
@end

@implementation LobeGuidePanel
- (BOOL)canBecomeKeyWindow {
  return NO;
}
- (BOOL)canBecomeMainWindow {
  return NO;
}
@end

@interface LobeGuideButton : NSButton
@end

@implementation LobeGuideButton
- (BOOL)acceptsFirstMouse:(NSEvent *)event {
  return YES;
}
@end

@interface LobeGuideIconView : NSView <NSDraggingSource>
@property (nonatomic, strong) NSImage *image;
@property (nonatomic, copy) NSString *dragPath;
@property (nonatomic, assign) BOOL dragging;
@end

@implementation LobeGuideIconView

- (BOOL)acceptsFirstMouse:(NSEvent *)event {
  return YES;
}

- (BOOL)mouseDownCanMoveWindow {
  return NO;
}

- (void)drawRect:(NSRect)dirtyRect {
  [self.image drawInRect:self.bounds
                fromRect:NSZeroRect
               operation:NSCompositingOperationSourceOver
                fraction:1
          respectFlipped:YES
                   hints:nil];
}

- (void)resetCursorRects {
  if (self.dragPath.length > 0) [self addCursorRect:self.bounds cursor:NSCursor.openHandCursor];
}

- (void)mouseDown:(NSEvent *)event {
}

- (void)mouseDragged:(NSEvent *)event {
  if (self.dragPath.length == 0 || self.dragging) return;
  self.dragging = YES;
  NSURL *url = [NSURL fileURLWithPath:self.dragPath];
  NSDraggingItem *item = [[NSDraggingItem alloc] initWithPasteboardWriter:url];
  [item setDraggingFrame:self.bounds contents:self.image];
  NSDraggingSession *session = [self beginDraggingSessionWithItems:@[ item ]
                                                             event:event
                                                            source:self];
  session.animatesToStartingPositionsOnCancelOrFail = YES;
  EmitEvent(@{@"type" : @"dragStarted"});
}

- (NSDragOperation)draggingSession:(NSDraggingSession *)session
    sourceOperationMaskForDraggingContext:(NSDraggingContext)context {
  return NSDragOperationCopy | NSDragOperationLink | NSDragOperationGeneric;
}

- (void)draggingSession:(NSDraggingSession *)session
           endedAtPoint:(NSPoint)screenPoint
              operation:(NSDragOperation)operation {
  self.dragging = NO;
  EmitEvent(@{@"type" : @"dragEnded", @"dropped" : @(operation != NSDragOperationNone)});
}

@end

@interface LobeGuideDragHintView : NSView
@property (nonatomic, strong) CAShapeLayer *ring;
@property (nonatomic, strong) CALayer *badge;
@end

@implementation LobeGuideDragHintView

- (instancetype)initWithFrame:(NSRect)frame {
  self = [super initWithFrame:frame];
  if (!self) return nil;
  self.wantsLayer = YES;
  self.layer.masksToBounds = NO;

  _ring = [CAShapeLayer layer];
  _ring.fillColor = NSColor.clearColor.CGColor;
  _ring.lineWidth = 1.5;
  _ring.lineDashPattern = @[ @4, @3 ];
  CGPathRef path = CGPathCreateWithRoundedRect(CGRectMake(2.75, 4.75, 42.5, 42.5), 11, 11, NULL);
  _ring.path = path;
  CGPathRelease(path);
  [self.layer addSublayer:_ring];

  _badge = [CALayer layer];
  _badge.frame = CGRectMake(34, 36, 16, 16);
  _badge.cornerRadius = 8;
  _badge.contentsGravity = kCAGravityCenter;
  [self.layer addSublayer:_badge];
  return self;
}

- (NSView *)hitTest:(NSPoint)point {
  return nil;
}

- (void)viewDidChangeEffectiveAppearance {
  [super viewDidChangeEffectiveAppearance];
  [self refreshColors];
}

- (void)refreshColors {
  [self.effectiveAppearance performAsCurrentDrawingAppearance:^{
    self.ring.strokeColor = NSColor.controlAccentColor.CGColor;
    self.badge.backgroundColor = NSColor.controlAccentColor.CGColor;
  }];
  NSImageSymbolConfiguration *config = [[NSImageSymbolConfiguration
      configurationWithPointSize:9
                          weight:NSFontWeightBold]
      configurationByApplyingConfiguration:[NSImageSymbolConfiguration
                                               configurationWithPaletteColors:@[ NSColor.whiteColor ]]];
  NSImage *arrow = [[NSImage imageWithSystemSymbolName:@"arrow.up" accessibilityDescription:nil]
      imageWithSymbolConfiguration:config];
  CGFloat scale = self.window.backingScaleFactor ?: NSScreen.mainScreen.backingScaleFactor;
  self.badge.contentsScale = scale;
  self.badge.contents = [arrow layerContentsForContentsScale:scale];
}

- (void)startAnimating {
  [self refreshColors];
  [self stopAnimating];
  if (NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion) return;

  CABasicAnimation *march = [CABasicAnimation animationWithKeyPath:@"lineDashPhase"];
  march.fromValue = @0;
  march.toValue = @(-7);
  march.duration = 0.6;
  march.repeatCount = HUGE_VALF;
  [self.ring addAnimation:march forKey:@"march"];

  CABasicAnimation *bob = [CABasicAnimation animationWithKeyPath:@"transform.translation.y"];
  bob.fromValue = @0;
  bob.toValue = @2.5;
  bob.duration = 0.6;
  bob.autoreverses = YES;
  bob.repeatCount = HUGE_VALF;
  bob.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseInEaseOut];
  [self.badge addAnimation:bob forKey:@"bob"];
}

- (void)stopAnimating {
  [self.ring removeAllAnimations];
  [self.badge removeAllAnimations];
}

@end

@interface LobeGuideController : NSObject
@property (nonatomic, strong) LobeGuidePanel *panel;
@property (nonatomic, strong) LobeGuideDragHintView *hintView;
@property (nonatomic, strong) LobeGuideIconView *iconView;
@property (nonatomic, strong) NSImageView *symbolView;
@property (nonatomic, strong) NSProgressIndicator *spinner;
@property (nonatomic, strong) NSTextField *titleLabel;
@property (nonatomic, strong) NSTextField *subtitleLabel;
@property (nonatomic, strong) LobeGuideButton *actionButton;
@property (nonatomic, strong) LobeGuideButton *closeButton;
@property (nonatomic, strong) NSTimer *timer;
@property (nonatomic, strong) NSDate *missingSince;
@property (nonatomic, assign) BOOL settingsLost;
@property (nonatomic, assign) CGFloat sidebarWidth;
@property (nonatomic, assign) CGFloat bottomInset;
@property (nonatomic, assign) NSTimeInterval missingTimeout;
@property (nonatomic, assign) uint32_t mainWindowNumber;
@property (nonatomic, assign) NSRect mainWindowFrame;
@property (nonatomic, copy) NSString *lastTitle;
@property (nonatomic, assign) BOOL promptVisible;
@property (nonatomic, strong) id clickMonitor;
@property (nonatomic, assign) BOOL hasAppeared;
@property (nonatomic, assign) BOOL hasLaunchOrigin;
@property (nonatomic, assign) NSPoint launchOrigin;
@property (nonatomic, assign) NSRect targetFrame;
@property (nonatomic, strong) NSTimer *flightTimer;
@property (nonatomic, assign) CFTimeInterval flightStartedAt;
@property (nonatomic, assign) LobeSpring positionSpring;
@property (nonatomic, assign) LobeSpring scaleSpring;
@property (nonatomic, assign) CFTimeInterval flightSettleTime;
@end

@implementation LobeGuideController

- (instancetype)init {
  self = [super init];
  if (!self) return nil;

  NSRect frame = NSMakeRect(0, 0, kPanelWidth, kPanelHeight);
  _panel = [[LobeGuidePanel alloc]
      initWithContentRect:frame
                styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel
                  backing:NSBackingStoreBuffered
                    defer:NO];
  _panel.floatingPanel = YES;
  _panel.level = NSFloatingWindowLevel;
  _panel.hidesOnDeactivate = NO;
  _panel.becomesKeyOnlyIfNeeded = YES;
  _panel.releasedWhenClosed = NO;
  _panel.movable = NO;
  _panel.opaque = NO;
  _panel.hasShadow = YES;
  _panel.backgroundColor = NSColor.clearColor;
  _panel.animationBehavior = NSWindowAnimationBehaviorUtilityWindow;
  _panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
                              NSWindowCollectionBehaviorFullScreenAuxiliary |
                              NSWindowCollectionBehaviorIgnoresCycle;

  NSView *container = [[NSView alloc] initWithFrame:frame];
  container.wantsLayer = YES;
  _panel.contentView = container;
  NSView *content = [self installBackgroundInto:container];

  _hintView = [[LobeGuideDragHintView alloc] initWithFrame:kHintFrame];
  [content addSubview:_hintView];

  _iconView = [[LobeGuideIconView alloc] initWithFrame:NSZeroRect];
  [_iconView setAccessibilityRole:NSAccessibilityImageRole];
  [content addSubview:_iconView];

  _symbolView = [NSImageView imageViewWithImage:[NSImage new]];
  _symbolView.imageScaling = NSImageScaleProportionallyUpOrDown;
  [content addSubview:_symbolView];

  _spinner = [NSProgressIndicator new];
  _spinner.style = NSProgressIndicatorStyleSpinning;
  _spinner.controlSize = NSControlSizeSmall;
  _spinner.displayedWhenStopped = NO;
  [content addSubview:_spinner];

  _titleLabel = [self makeLabelWithFont:[NSFont systemFontOfSize:13 weight:NSFontWeightSemibold]
                                  color:NSColor.labelColor];
  _subtitleLabel = [self makeLabelWithFont:[NSFont systemFontOfSize:11]
                                     color:NSColor.secondaryLabelColor];
  [content addSubview:_titleLabel];
  [content addSubview:_subtitleLabel];

  _actionButton = [LobeGuideButton buttonWithTitle:@"" target:self action:@selector(onAction:)];
  _actionButton.bezelStyle = NSBezelStylePush;
  _actionButton.controlSize = NSControlSizeRegular;
  [content addSubview:_actionButton];

  NSImageSymbolConfiguration *closeConfig =
      [NSImageSymbolConfiguration configurationWithPointSize:15 weight:NSFontWeightRegular];
  NSImage *closeImage = [[NSImage imageWithSystemSymbolName:@"xmark.circle.fill"
                                   accessibilityDescription:nil]
      imageWithSymbolConfiguration:closeConfig];
  _closeButton = [LobeGuideButton buttonWithImage:closeImage target:self action:@selector(onClose:)];
  _closeButton.bordered = NO;
  _closeButton.contentTintColor = NSColor.tertiaryLabelColor;
  [content addSubview:_closeButton];

  _sidebarWidth = 0;
  _bottomInset = 20;
  _missingTimeout = 3;
  return self;
}

- (NSView *)installBackgroundInto:(NSView *)container {
  NSRect bounds = container.bounds;
  NSView *content = [[NSView alloc] initWithFrame:bounds];
  content.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;

  // NSGlassEffectView ships with macOS 26; resolve it at runtime so the addon
  // still builds against older SDKs and runs on older systems.
  Class glassClass = NSClassFromString(@"NSGlassEffectView");
  if (glassClass) {
    NSView *glass = [[glassClass alloc] initWithFrame:bounds];
    glass.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [glass setValue:@(kCornerRadius) forKey:@"cornerRadius"];
    [glass setValue:content forKey:@"contentView"];
    [container addSubview:glass];
    return content;
  }

  NSVisualEffectView *effect = [[NSVisualEffectView alloc] initWithFrame:bounds];
  effect.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  effect.material = NSVisualEffectMaterialPopover;
  effect.blendingMode = NSVisualEffectBlendingModeBehindWindow;
  effect.state = NSVisualEffectStateActive;
  effect.maskImage = [NSImage imageWithSize:bounds.size
                                    flipped:NO
                             drawingHandler:^BOOL(NSRect rect) {
                               [[NSBezierPath bezierPathWithRoundedRect:rect
                                                                xRadius:kCornerRadius
                                                                yRadius:kCornerRadius] fill];
                               return YES;
                             }];
  [effect addSubview:content];
  [container addSubview:effect];
  return content;
}

- (NSTextField *)makeLabelWithFont:(NSFont *)font color:(NSColor *)color {
  NSTextField *label = [NSTextField labelWithString:@""];
  label.font = font;
  label.textColor = color;
  label.lineBreakMode = NSLineBreakByTruncatingTail;
  label.maximumNumberOfLines = 1;
  return label;
}

- (void)applyState:(NSDictionary *)state {
  NSString *accessory = StringValue(state, @"accessory");
  NSString *appPath = StringValue(state, @"appPath");
  BOOL draggable = [state[@"draggable"] boolValue] && appPath.length > 0;

  self.sidebarWidth = NumberValue(state, @"sidebarWidth", 0);
  self.bottomInset = NumberValue(state, @"bottomInset", 20);
  self.missingTimeout = NumberValue(state, @"missingTimeoutMs", 3000) / 1000.0;

  NSDictionary *origin = state[@"launchOrigin"];
  if (!self.hasAppeared && [origin isKindOfClass:[NSDictionary class]]) {
    CGFloat primaryHeight = NSScreen.screens.firstObject.frame.size.height;
    self.launchOrigin = NSMakePoint(NumberValue(origin, @"x", 0),
                                    primaryHeight - NumberValue(origin, @"y", 0));
    self.hasLaunchOrigin = YES;
  }

  BOOL showsIcon = [accessory isEqualToString:@"appIcon"] || [accessory isEqualToString:@"settingsIcon"];
  self.iconView.hidden = !showsIcon;
  if (showsIcon) {
    NSString *iconPath = appPath;
    if ([accessory isEqualToString:@"settingsIcon"]) {
      iconPath = [[NSWorkspace.sharedWorkspace URLForApplicationWithBundleIdentifier:kSettingsBundleId] path];
    }
    self.iconView.image = iconPath.length > 0 ? [NSWorkspace.sharedWorkspace iconForFile:iconPath] : nil;
    [self.iconView setAccessibilityLabel:StringValue(state, @"iconLabel")];
  }
  self.iconView.dragPath = showsIcon && draggable ? appPath : nil;
  self.hintView.hidden = self.iconView.dragPath == nil;
  if (self.hintView.hidden) {
    [self.hintView stopAnimating];
  } else {
    [self.hintView startAnimating];
  }
  [self.panel invalidateCursorRectsForView:self.iconView];
  self.iconView.needsDisplay = YES;

  BOOL showsSuccess = [accessory isEqualToString:@"success"];
  self.symbolView.hidden = !showsSuccess;
  if (showsSuccess) {
    NSImageSymbolConfiguration *config =
        [NSImageSymbolConfiguration configurationWithPointSize:20 weight:NSFontWeightRegular];
    self.symbolView.image = [[NSImage imageWithSystemSymbolName:@"checkmark.circle.fill"
                                       accessibilityDescription:nil]
        imageWithSymbolConfiguration:config];
    self.symbolView.contentTintColor = NSColor.systemGreenColor;
  }

  if ([accessory isEqualToString:@"spinner"]) {
    [self.spinner startAnimation:nil];
  } else {
    [self.spinner stopAnimation:nil];
  }

  self.titleLabel.stringValue = StringValue(state, @"title");
  self.subtitleLabel.stringValue = StringValue(state, @"subtitle");
  self.subtitleLabel.hidden = self.subtitleLabel.stringValue.length == 0;

  NSString *actionLabel = StringValue(state, @"actionLabel");
  self.actionButton.hidden = actionLabel.length == 0;
  self.actionButton.title = actionLabel;
  self.actionButton.bezelColor = [StringValue(state, @"actionStyle") isEqualToString:@"primary"]
                                     ? NSColor.controlAccentColor
                                     : nil;
  [self.closeButton setAccessibilityLabel:StringValue(state, @"closeLabel")];
  self.closeButton.toolTip = StringValue(state, @"closeLabel");

  [self layoutContent];
}

- (void)layoutContent {
  CGFloat right = kPanelWidth - 10;
  self.closeButton.frame = NSMakeRect(right - 20, (kPanelHeight - 20) / 2, 20, 20);
  right -= 20 + 8;

  if (!self.actionButton.hidden) {
    [self.actionButton sizeToFit];
    NSSize size = self.actionButton.frame.size;
    CGFloat width = MAX(size.width, 64);
    self.actionButton.frame =
        NSMakeRect(right - width, round((kPanelHeight - size.height) / 2), width, size.height);
    right -= width + 8;
  }

  self.iconView.frame = kAccessoryFrame;
  self.symbolView.frame = NSInsetRect(kAccessoryFrame, 5, 5);
  self.spinner.frame = NSInsetRect(kAccessoryFrame, 8, 8);

  CGFloat textWidth = MAX(right - kTextX, 40);
  if (self.subtitleLabel.hidden) {
    self.titleLabel.frame = NSMakeRect(kTextX, (kPanelHeight - 16) / 2, textWidth, 16);
  } else {
    self.titleLabel.frame = NSMakeRect(kTextX, 28, textWidth, 16);
    self.subtitleLabel.frame = NSMakeRect(kTextX, 12, textWidth, 14);
  }
}

- (void)start {
  if (self.timer) return;
  __weak LobeGuideController *weakSelf = self;
  self.timer = [NSTimer timerWithTimeInterval:1.0 / 60.0
                                      repeats:YES
                                        block:^(NSTimer *timer) {
                                          [weakSelf tick];
                                        }];
  // Common modes keep the panel following while the user drags the Settings
  // window or our icon, both of which spin the run loop in tracking mode.
  [NSRunLoop.mainRunLoop addTimer:self.timer forMode:NSRunLoopCommonModes];
  self.clickMonitor = [NSEvent addGlobalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown
                                                             handler:^(NSEvent *event) {
                                                               [weakSelf handleGlobalClick];
                                                             }];
  [self tick];
}

- (void)stop {
  [self.flightTimer invalidate];
  self.flightTimer = nil;
  [self.hintView stopAnimating];
  [self.timer invalidate];
  self.timer = nil;
  if (self.clickMonitor) [NSEvent removeMonitor:self.clickMonitor];
  self.clickMonitor = nil;
  [self.spinner stopAnimation:nil];
  [self.panel orderOut:nil];
}

- (LobeSettingsWindow *)resolveMainWindow:(NSArray<LobeSettingsWindow *> *)windows {
  for (LobeSettingsWindow *window in windows) {
    if (window.number == self.mainWindowNumber) return window;
  }
  LobeSettingsWindow *largest = nil;
  for (LobeSettingsWindow *window in windows) {
    if (!IsMainWindowCandidate(window)) continue;
    CGFloat area = window.bounds.size.width * window.bounds.size.height;
    if (!largest || area > largest.bounds.size.width * largest.bounds.size.height) largest = window;
  }
  self.mainWindowNumber = largest.number;
  return largest;
}

- (void)updatePromptVisible:(BOOL)visible {
  if (visible == self.promptVisible) return;
  self.promptVisible = visible;
  EmitEvent(@{@"type" : visible ? @"promptShown" : @"promptDismissed"});
}

- (void)tick {
  NSArray<LobeSettingsWindow *> *windows = SettingsWindows();
  LobeSettingsWindow *main = [self resolveMainWindow:windows];

  if (main) {
    self.missingSince = nil;
    self.mainWindowFrame = CocoaRectFromWindowBounds(main.bounds);
    if (self.settingsLost) {
      self.settingsLost = NO;
      EmitEvent(@{@"type" : @"settingsFound"});
    }
    if (main.title.length > 0 && ![main.title isEqualToString:self.lastTitle]) {
      self.lastTitle = main.title;
      EmitEvent(@{@"type" : @"windowTitle", @"title" : main.title});
    }
    BOOL prompt = NO;
    for (LobeSettingsWindow *window in windows) {
      if (IsPromptWindow(window, main)) prompt = YES;
    }
    [self updatePromptVisible:prompt];

    if (!ShouldShowAlongside(NSWorkspace.sharedWorkspace.frontmostApplication)) {
      if (self.panel.visible) [self.panel orderOut:nil];
      return;
    }
    [self placeAt:PanelFrameForSettingsWindow(main.bounds, self.sidebarWidth, self.bottomInset)];
    return;
  }

  self.mainWindowFrame = NSZeroRect;
  [self updatePromptVisible:NO];
  if (!self.missingSince) self.missingSince = [NSDate date];
  if (!self.settingsLost && -[self.missingSince timeIntervalSinceNow] >= self.missingTimeout) {
    self.settingsLost = YES;
    EmitEvent(@{@"type" : @"settingsLost"});
  }
  if (!self.settingsLost) {
    if (self.panel.visible) [self.panel orderOut:nil];
    return;
  }

  NSRect visible = NSScreen.mainScreen.visibleFrame;
  [self placeAt:NSMakeRect(round(NSMidX(visible) - kPanelWidth / 2), round(NSMidY(visible) - kPanelHeight / 2),
                           kPanelWidth, kPanelHeight)];
}

// Without Screen Recording the pane title is unreadable, so a click on the
// sidebar or the toolbar back/forward buttons is the only hint that the user
// navigated away from the privacy list.
- (void)handleGlobalClick {
  NSRect frame = self.mainWindowFrame;
  if (NSIsEmptyRect(frame)) return;
  NSPoint point = NSEvent.mouseLocation;
  if (!NSPointInRect(point, frame)) return;

  CGFloat sidebar = self.sidebarWidth > 0 ? self.sidebarWidth : 220;
  CGFloat fromTop = NSMaxY(frame) - point.y;
  CGFloat fromLeft = point.x - NSMinX(frame);
  BOOL inSidebar = fromLeft <= sidebar && fromTop > 40;
  BOOL inNavigation = fromTop <= 52 && fromLeft > sidebar && fromLeft <= sidebar + 90;
  if (inSidebar || inNavigation) EmitEvent(@{@"type" : @"navigationClicked"});
}

static const CGFloat kFlightStartScale = 0.3;

- (void)applyFlightScale:(CGFloat)scale {
  CGFloat cx = kPanelWidth / 2, cy = kPanelHeight / 2;
  CATransform3D transform = CATransform3DMakeTranslation(cx, cy, 0);
  transform = CATransform3DScale(transform, scale, scale, 1);
  transform = CATransform3DTranslate(transform, -cx, -cy, 0);
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  self.panel.contentView.layer.sublayerTransform = transform;
  [CATransaction commit];
}

- (void)beginFlight {
  NSPoint end = NSMakePoint(NSMidX(self.targetFrame), NSMidY(self.targetFrame));
  CGFloat distance = hypot(end.x - self.launchOrigin.x, end.y - self.launchOrigin.y);

  // Position starts at rest and lands with a small overshoot; scale shares the
  // response but is bouncier, so its pop peaks right as the panel touches down.
  double response = MIN(MAX(0.5 + distance / 5000, 0.5), 0.68);
  self.positionSpring = SpringMake(response, 0.82, 0);
  self.scaleSpring = SpringMake(response, 0.6, 0);
  double tolerance = MAX(0.5 / MAX(distance, 1), 0.0005);
  self.flightSettleTime = MAX(SpringSettleTime(self.positionSpring, tolerance),
                              SpringSettleTime(self.scaleSpring, 0.002));
  self.flightStartedAt = CACurrentMediaTime();

  self.panel.alphaValue = 0;
  [self applyFlightScale:kFlightStartScale];
  [self.panel setFrameOrigin:NSMakePoint(round(self.launchOrigin.x - kPanelWidth / 2),
                                         round(self.launchOrigin.y - kPanelHeight / 2))];
  [self.panel orderFrontRegardless];

  __weak LobeGuideController *weakSelf = self;
  self.flightTimer = [NSTimer timerWithTimeInterval:1.0 / 120.0
                                            repeats:YES
                                              block:^(NSTimer *timer) {
                                                [weakSelf stepFlight];
                                              }];
  [NSRunLoop.mainRunLoop addTimer:self.flightTimer forMode:NSRunLoopCommonModes];
}

- (void)stepFlight {
  double elapsed = CACurrentMediaTime() - self.flightStartedAt;
  if (elapsed >= self.flightSettleTime) {
    [self.flightTimer invalidate];
    self.flightTimer = nil;
    [self applyFlightScale:1];
    self.panel.alphaValue = 1;
    [self.panel setFrame:self.targetFrame display:YES];
    [self.panel invalidateShadow];
    return;
  }

  // A quadratic curve whose control point sits above both ends traces the
  // parabola of a thrown object; past 1 the spring overshoot continues along
  // the same arc before settling back. The end tracks Settings if it moves.
  CGFloat p = SpringValue(self.positionSpring, elapsed);
  NSPoint start = self.launchOrigin;
  NSPoint end = NSMakePoint(NSMidX(self.targetFrame), NSMidY(self.targetFrame));
  CGFloat distance = hypot(end.x - start.x, end.y - start.y);
  CGFloat lift = MIN(MAX(distance * 0.35, 80), 320);
  NSPoint control = NSMakePoint((start.x + end.x) / 2, MAX(start.y, end.y) + lift);
  CGFloat u = 1 - p;
  CGFloat x = u * u * start.x + 2 * u * p * control.x + p * p * end.x;
  CGFloat y = u * u * start.y + 2 * u * p * control.y + p * p * end.y;

  [self.panel setFrameOrigin:NSMakePoint(round(x - kPanelWidth / 2), round(y - kPanelHeight / 2))];
  CGFloat scale = kFlightStartScale + (1 - kFlightStartScale) * SpringValue(self.scaleSpring, elapsed);
  [self applyFlightScale:scale];
  self.panel.alphaValue = MIN(elapsed / 0.08, 1);
  [self.panel invalidateShadow];
}

- (void)placeAt:(NSRect)frame {
  self.targetFrame = frame;
  if (self.flightTimer) return;
  if (!self.hasAppeared) {
    self.hasAppeared = YES;
    if (self.hasLaunchOrigin && !NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion) {
      [self beginFlight];
      return;
    }
  }
  if (!NSEqualRects(self.panel.frame, frame)) [self.panel setFrame:frame display:YES];
  if (!self.panel.visible) {
    [self.panel orderFrontRegardless];
    [self.panel invalidateShadow];
  }
}

- (void)onAction:(id)sender {
  EmitEvent(@{@"type" : @"action"});
}

- (void)onClose:(id)sender {
  EmitEvent(@{@"type" : @"close"});
}

@end

static LobeGuideController *gController = nil;

static Napi::Value Setup(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (gEventTsfnActive) return Napi::Boolean::New(env, true);
  Napi::Function cb = info[0].As<Napi::Function>();
  gEventTsfn = Napi::ThreadSafeFunction::New(env, cb, "lobehub-mac-permission-guide", 0, 1);
  gEventTsfn.Unref(env);
  gEventTsfnActive = true;
  return Napi::Boolean::New(env, true);
}

static Napi::Value Show(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  std::string json = info[0].As<Napi::String>().Utf8Value();
  NSData *data = [NSData dataWithBytes:json.data() length:json.size()];
  NSDictionary *state = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (![state isKindOfClass:[NSDictionary class]]) {
    Napi::TypeError::New(env, "invalid guide state").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  RunOnMain(^{
    if (!gController) gController = [LobeGuideController new];
    [gController applyState:state];
    [gController start];
  });
  return env.Undefined();
}

static Napi::Value Hide(const Napi::CallbackInfo &info) {
  RunOnMain(^{
    [gController stop];
    gController = nil;
  });
  return info.Env().Undefined();
}

static Napi::Value ActivateSettings(const Napi::CallbackInfo &info) {
  RunOnMain(^{
    NSRunningApplication *settings =
        [NSRunningApplication runningApplicationsWithBundleIdentifier:kSettingsBundleId].firstObject;
    if (!settings) return;
    // A deep link into an already running Settings switches panes without
    // raising it, and the panel only shows while Settings is frontmost.
    if (@available(macOS 14.0, *)) [NSApp yieldActivationToApplication:settings];
    [settings activateWithOptions:NSApplicationActivateAllWindows];
  });
  return info.Env().Undefined();
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("activateSettings", Napi::Function::New(env, ActivateSettings));
  exports.Set("setup", Napi::Function::New(env, Setup));
  exports.Set("show", Napi::Function::New(env, Show));
  exports.Set("hide", Napi::Function::New(env, Hide));
  return exports;
}

NODE_API_MODULE(lobehub_mac_permission_guide, Init)
