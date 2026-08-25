{
  "targets": [
    {
      "target_name": "lobehub_mac_notifications",
      "sources": ["native/addon.mm"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "OTHER_CPLUSPLUSFLAGS": ["-fobjc-arc", "-std=c++17"],
              "OTHER_LDFLAGS": [
                "-framework Foundation",
                "-framework UserNotifications",
                "-framework Intents"
              ],
              "MACOSX_DEPLOYMENT_TARGET": "12.0"
            }
          }
        ]
      ]
    }
  ]
}
