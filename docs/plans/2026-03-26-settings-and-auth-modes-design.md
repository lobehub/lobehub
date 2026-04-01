# Settings Entry and Auth Mode Switch Design

## Goals

- Add a dedicated settings icon entry in the desktop home layout footer (bottom-left area).
- Hide `About` and `Creds` from visible settings category navigation.
- Allow users to choose between `email/username` and `phone` modes on both sign-in and sign-up pages.
- Keep phone auth on a dedicated flow with a standalone `Send code` button.

## Approach

### Settings entry

Use the existing desktop home footer (`src/routes/(main)/home/_layout/Footer/index.tsx`) as the stable bottom-left insertion point. Add a direct link to `/settings` next to the existing dev/eval icon area.

### Settings visibility

Hide `SettingsTabs.About` and `SettingsTabs.Creds` from category lists only. This keeps the existing routes/components intact while removing them from normal user-facing settings navigation.

### Auth mode switching

Introduce a small shared auth mode switch component used by both sign-in and sign-up pages.

- `email` mode:
  - Sign-in keeps the current email-or-username flow.
  - Sign-up keeps the current username + email + password flow.
- `phone` mode:
  - Reuse the existing phone OTP flow.
  - Render phone entry as its own step/card.
  - Use a separate button below the phone input to request OTP.

### Sign-up phone mode

Phone sign-up uses the same OTP verification endpoint as phone sign-in. After successful verification, the app redirects to the callback URL, relying on the existing auto-register-on-phone-login backend behavior.

## Validation

- Focused lint on changed TS/TSX files.
- Focused auth component tests for sign-in/sign-up mode switching and phone button behavior.
