on run argv
  set appBundlePath to item 1 of argv

  set settingsBundleIds to {"com.apple.SystemSettings", "com.apple.systempreferences"}

  -- Bring System Settings/Preferences to front (Ventura+ / older). If it doesn't exist, ignore.
  repeat with bundleId in settingsBundleIds
    try
      tell application id bundleId to activate
      exit repeat
    end try
  end repeat

  tell application "System Events"
    set settingsProcess to missing value
    repeat 30 times
      repeat with bundleId in settingsBundleIds
        try
          if exists (first process whose bundle identifier is bundleId) then
            set settingsProcess to first process whose bundle identifier is bundleId
            exit repeat
          end if
        end try
      end repeat

      if settingsProcess is not missing value then exit repeat
      delay 0.2
    end repeat

    if settingsProcess is missing value then return "no-settings-process"

    tell settingsProcess
      set frontmost to true

      repeat 30 times
        if exists window 1 then exit repeat
        delay 0.2
      end repeat
      if not (exists window 1) then return "no-window"

      -- Best-effort: find an "add" button in the front window and click it.
      set clickedAdd to false
      repeat 30 times
        try
          repeat with b in (buttons of window 1)
            set bDesc to ""
            set bName to ""
            set bTitle to ""
            try set bDesc to description of b end try
            try set bName to name of b end try
            try set bTitle to title of b end try

            if (bDesc is "Add") or (bTitle is "Add") or (bName is "+") or (bTitle is "+") then
              click b
              set clickedAdd to true
              exit repeat
            end if
          end repeat
        end try

        if clickedAdd is true then exit repeat
        delay 0.2
      end repeat

      if clickedAdd is false then return "no-add-button"

      -- Wait for open panel / sheet
      repeat 30 times
        if exists sheet 1 of window 1 then exit repeat
        delay 0.2
      end repeat
      if not (exists sheet 1 of window 1) then return "no-sheet"

      -- Open "Go to the folder" and input the app bundle path, then confirm.
      keystroke "G" using {command down, shift down}
      delay 0.3
      keystroke appBundlePath
      key code 36
      delay 0.6
      -- Confirm "Open" in the panel (Enter usually triggers default)
      key code 36
      return "ok"
    end tell
  end tell
end run
