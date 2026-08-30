#include <napi.h>

#import <Foundation/Foundation.h>
#import <Intents/Intents.h>
#import <UserNotifications/UserNotifications.h>

static NSString *const kNotificationIdPrefix = @"lobehub-";

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

static void EmitForId(NSString *type, NSString *identifier, NSString *errorMessage) {
  NSMutableDictionary *payload = [NSMutableDictionary dictionary];
  payload[@"type"] = type;
  payload[@"id"] = identifier ?: @"";
  if (errorMessage) payload[@"error"] = errorMessage;
  EmitEvent(payload);
}

static bool IsOwnedIdentifier(NSString *identifier) {
  return identifier != nil && [identifier hasPrefix:kNotificationIdPrefix];
}

@interface LobeNotificationDelegate : NSObject <UNUserNotificationCenterDelegate>
@property (nonatomic, weak) id<UNUserNotificationCenterDelegate> previousDelegate;
@end

@implementation LobeNotificationDelegate

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completionHandler {
  if (IsOwnedIdentifier(notification.request.identifier)) {
    completionHandler(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList |
                      UNNotificationPresentationOptionSound);
    return;
  }
  if ([self.previousDelegate
          respondsToSelector:@selector(userNotificationCenter:willPresentNotification:withCompletionHandler:)]) {
    [self.previousDelegate userNotificationCenter:center
                          willPresentNotification:notification
                            withCompletionHandler:completionHandler];
    return;
  }
  completionHandler(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList);
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
    didReceiveNotificationResponse:(UNNotificationResponse *)response
             withCompletionHandler:(void (^)(void))completionHandler {
  NSString *identifier = response.notification.request.identifier;
  if (IsOwnedIdentifier(identifier)) {
    if ([response.actionIdentifier isEqualToString:UNNotificationDefaultActionIdentifier]) {
      EmitForId(@"clicked", identifier, nil);
    }
    completionHandler();
    return;
  }
  if ([self.previousDelegate
          respondsToSelector:@selector(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:)]) {
    [self.previousDelegate userNotificationCenter:center
                   didReceiveNotificationResponse:response
                            withCompletionHandler:completionHandler];
    return;
  }
  completionHandler();
}

@end

static LobeNotificationDelegate *gDelegate = nil;

static void EnsureDelegateInstalled() {
  dispatch_async(dispatch_get_main_queue(), ^{
    UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
    if (center.delegate == gDelegate && gDelegate != nil) return;
    LobeNotificationDelegate *delegate = [LobeNotificationDelegate new];
    delegate.previousDelegate = center.delegate;
    gDelegate = delegate;
    center.delegate = delegate;
  });
}

static Napi::Value Setup(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (gEventTsfnActive) return Napi::Boolean::New(env, true);
  Napi::Function cb = info[0].As<Napi::Function>();
  gEventTsfn = Napi::ThreadSafeFunction::New(env, cb, "lobehub-mac-notifications", 0, 1);
  gEventTsfn.Unref(env);
  gEventTsfnActive = true;
  EnsureDelegateInstalled();
  return Napi::Boolean::New(env, true);
}

static void ShowWithAuthorization(NSString *identifier, NSString *title, NSString *body, bool silent,
                                  NSString *senderName, NSString *conversationId, NSData *avatarData) {
  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
  [center requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound |
                                           UNAuthorizationOptionBadge)
                        completionHandler:^(BOOL granted, NSError *authError) {
    if (!granted) {
      EmitForId(@"failed", identifier,
                authError ? authError.localizedDescription : @"notifications not authorized");
      return;
    }

    UNMutableNotificationContent *content = [UNMutableNotificationContent new];
    content.title = title ?: @"";
    content.body = body ?: @"";
    if (!silent) content.sound = [UNNotificationSound defaultSound];

    UNNotificationContent *finalContent = content;
    if (senderName.length > 0) {
      if (@available(macOS 12.0, *)) {
        INImage *avatar = avatarData.length > 0 ? [INImage imageWithImageData:avatarData] : nil;
        NSPersonNameComponents *nameComponents = [NSPersonNameComponents new];
        nameComponents.nickname = senderName;
        INPersonHandle *handle =
            [[INPersonHandle alloc] initWithValue:conversationId ?: senderName
                                             type:INPersonHandleTypeUnknown];
        INPerson *sender = [[INPerson alloc] initWithPersonHandle:handle
                                                   nameComponents:nameComponents
                                                      displayName:senderName
                                                            image:avatar
                                                contactIdentifier:nil
                                                 customIdentifier:conversationId];
        INSendMessageIntent *intent =
            [[INSendMessageIntent alloc] initWithRecipients:nil
                                        outgoingMessageType:INOutgoingMessageTypeOutgoingMessageText
                                                    content:body
                                         speakableGroupName:nil
                                     conversationIdentifier:conversationId ?: identifier
                                                serviceName:nil
                                                     sender:sender
                                                attachments:nil];
        if (avatar) [intent setImage:avatar forParameterNamed:@"sender"];

        INInteraction *interaction = [[INInteraction alloc] initWithIntent:intent response:nil];
        interaction.direction = INInteractionDirectionIncoming;
        [interaction donateInteractionWithCompletion:nil];

        NSError *updateError = nil;
        UNNotificationContent *updated = [content contentByUpdatingWithProvider:intent
                                                                          error:&updateError];
        if (updated) finalContent = updated;
      }
    }

    UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:identifier
                                                                          content:finalContent
                                                                          trigger:nil];
    [center addNotificationRequest:request
             withCompletionHandler:^(NSError *addError) {
      if (addError) {
        EmitForId(@"failed", identifier, addError.localizedDescription);
      } else {
        EmitForId(@"shown", identifier, nil);
      }
    }];
  }];
}

static Napi::Value Show(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  std::string json = info[0].As<Napi::String>().Utf8Value();

  NSData *avatarData = nil;
  if (info.Length() > 1 && info[1].IsBuffer()) {
    Napi::Buffer<uint8_t> buffer = info[1].As<Napi::Buffer<uint8_t>>();
    avatarData = [NSData dataWithBytes:buffer.Data() length:buffer.Length()];
  }

  NSData *jsonData = [NSData dataWithBytes:json.data() length:json.size()];
  NSError *parseError = nil;
  NSDictionary *options = [NSJSONSerialization JSONObjectWithData:jsonData
                                                          options:0
                                                            error:&parseError];
  if (![options isKindOfClass:[NSDictionary class]]) {
    Napi::TypeError::New(env, "invalid options payload").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  NSString *identifier = options[@"id"];
  NSString *title = options[@"title"];
  NSString *body = options[@"body"];
  bool silent = [options[@"silent"] boolValue];
  NSDictionary *senderDict =
      [options[@"sender"] isKindOfClass:[NSDictionary class]] ? options[@"sender"] : nil;
  NSString *senderName = senderDict[@"name"];
  NSString *conversationId = senderDict[@"conversationId"];

  EnsureDelegateInstalled();
  dispatch_async(dispatch_get_main_queue(), ^{
    ShowWithAuthorization(identifier, title, body, silent, senderName, conversationId, avatarData);
  });
  return env.Undefined();
}

static Napi::Value GetAuthorizationStatus(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  Napi::Function cb = info[0].As<Napi::Function>();
  auto tsfn = Napi::ThreadSafeFunction::New(env, cb, "lobehub-mac-notifications-status", 0, 1);
  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
  [center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
    long status = (long)settings.authorizationStatus;
    tsfn.NonBlockingCall(
        [status](Napi::Env env, Napi::Function fn) { fn.Call({Napi::Number::New(env, status)}); });
    tsfn.Release();
  }];
  return env.Undefined();
}

static Napi::Value RequestAuthorization(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  Napi::Function cb = info[0].As<Napi::Function>();
  auto tsfn = Napi::ThreadSafeFunction::New(env, cb, "lobehub-mac-notifications-request", 0, 1);
  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
  [center requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound |
                                           UNAuthorizationOptionBadge)
                        completionHandler:^(BOOL granted, NSError *error) {
    bool ok = granted;
    tsfn.NonBlockingCall(
        [ok](Napi::Env env, Napi::Function fn) { fn.Call({Napi::Boolean::New(env, ok)}); });
    tsfn.Release();
  }];
  return env.Undefined();
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("setup", Napi::Function::New(env, Setup));
  exports.Set("show", Napi::Function::New(env, Show));
  exports.Set("getAuthorizationStatus", Napi::Function::New(env, GetAuthorizationStatus));
  exports.Set("requestAuthorization", Napi::Function::New(env, RequestAuthorization));
  return exports;
}

NODE_API_MODULE(lobehub_mac_notifications, Init)
