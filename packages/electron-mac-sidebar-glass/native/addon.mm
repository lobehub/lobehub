#import <AppKit/AppKit.h>
#import <objc/runtime.h>

#include <cstring>
#include <napi.h>

// The window owns the material. No renderer lifecycle, global registry, or observers.
static char kWindowGlassKey;

@interface LobeWindowGlass : NSView
@property(nonatomic, strong) NSSplitViewController *sidebarController;
@end

@implementation LobeWindowGlass
- (instancetype)initWithFrame:(NSRect)frame {
  self = [super initWithFrame:frame];
  if (!self) return nil;

  NSViewController *sidebar = [[NSViewController alloc] init];
  sidebar.view = [[NSView alloc] initWithFrame:self.bounds];
  NSSplitViewItem *item = [NSSplitViewItem sidebarWithViewController:sidebar];
  item.canCollapse = NO;
  item.minimumThickness = NSSplitViewItemUnspecifiedDimension;
  item.maximumThickness = NSSplitViewItemUnspecifiedDimension;

  self.sidebarController = [[NSSplitViewController alloc] init];
  [self.sidebarController addSplitViewItem:item];
  NSView *material = self.sidebarController.view;
  material.frame = self.bounds;
  material.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [self addSubview:material];
  return self;
}

- (NSView *)hitTest:(NSPoint)point {
  return nil;
}
@end

static Napi::Value IsSupported(const Napi::CallbackInfo &info) {
  return Napi::Boolean::New(info.Env(), NSClassFromString(@"NSGlassEffectView") != Nil);
}

static Napi::Value SetWindowGlass(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() != 3 || !info[0].IsBuffer() || !info[1].IsBoolean() ||
      !info[2].IsBoolean() || ![NSThread isMainThread]) {
    return Napi::Boolean::New(env, false);
  }

  auto handle = info[0].As<Napi::Buffer<uint8_t>>();
  if (handle.Length() != sizeof(NSView *)) return Napi::Boolean::New(env, false);

  void *pointer = nullptr;
  std::memcpy(&pointer, handle.Data(), sizeof(pointer));
  // Electron's getNativeWindowHandle() returns an NSView pointer on macOS.
  NSView *electronView = (__bridge NSView *)pointer;
  NSWindow *window = electronView.window;
  NSView *contentView = window.contentView;
  if (!contentView) return Napi::Boolean::New(env, false);

  @try {
    LobeWindowGlass *glass = objc_getAssociatedObject(contentView, &kWindowGlassKey);
    if (!info[1].As<Napi::Boolean>().Value()) {
      [glass removeFromSuperview];
      objc_setAssociatedObject(contentView, &kWindowGlassKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
      return Napi::Boolean::New(env, true);
    }

    if (!NSClassFromString(@"NSGlassEffectView")) return Napi::Boolean::New(env, false);

    if (!glass) {
      glass = [[LobeWindowGlass alloc] initWithFrame:contentView.bounds];
      glass.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
      [contentView addSubview:glass positioned:NSWindowBelow relativeTo:nil];
      objc_setAssociatedObject(contentView, &kWindowGlassKey, glass, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }

    glass.appearance = [NSAppearance appearanceNamed:info[2].As<Napi::Boolean>().Value()
        ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
    [glass.appearance performAsCurrentDrawingAppearance:^{
      // Match a standard AppKit sidebar window, rather than exposing the desktop
      // through a cleared Electron window and compensating with a custom alpha.
      window.backgroundColor = NSColor.windowBackgroundColor;
    }];
    window.opaque = YES;
    return Napi::Boolean::New(env, true);
  } @catch (NSException *exception) {
    NSLog(@"[electron-mac-sidebar-glass] Failed to update window material: %@", exception);
    return Napi::Boolean::New(env, false);
  }
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("isSupported", Napi::Function::New(env, IsSupported));
  exports.Set("setWindowGlass", Napi::Function::New(env, SetWindowGlass));
  return exports;
}

NODE_API_MODULE(lobehub_mac_sidebar_glass, Init)
