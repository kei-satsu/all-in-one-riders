# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

## Web and PWA

The project targets Android and the web from the same Expo Router source. To build the installable PWA:

```bash
npm run web:build
```

This exports the static website to `dist/`. Serve or deploy that folder over HTTPS. For example, after linking the project to EAS, deploy it with:

```bash
npx eas-cli@latest deploy --prod
```

To release Android from the same code changes, build it separately:

```bash
npx eas-cli@latest build --platform android --profile production
```

The web deployment and Android app release are separate channels, so publish both from the same source revision when shipping an update. PWA camera and location access require browser permission and HTTPS. PWA location broadcasting runs only while the page is open; browsers cannot provide the native app's background tracking. The native tracker requests location updates about every 10 seconds without requiring a minimum travel distance, but Android may still delay background task delivery because of battery management or system conditions (especially on vendor-customized devices). The app reports the GPS fix time rather than making an old coordinate appear newly measured. Exact background intervals cannot be guaranteed, and live delivery still requires an internet connection.

## Mobile OTA updates

The Android and iOS apps use EAS Update channels (`preview` and `production`) with `runtimeVersion` based on the app version. Compatible JavaScript, UI, and bundled asset changes can be sent without reinstalling the app:

```sh
npx eas-cli update --channel production --environment production --message "Describe the update"
```

The app checks for updates when it opens. With the current `fallbackToCacheTimeout: 0` setting, a downloaded update is used the next time the app reloads; users may need to close and reopen the app.

**One-time upgrade required:** an app build must already include `expo-updates` to receive OTA updates. Builds installed before EAS Update was configured cannot be made OTA-capable remotely. Build and distribute a new production binary once, then users on that build can receive compatible OTA updates:

```sh
npx eas-cli build --platform all --profile production
```

Before building or publishing, sign in with `npx eas-cli login` using an Expo account that has access to this project. Configure the app's required `EXPO_PUBLIC_*` variables in the EAS `production` environment, then use that same environment for both the production build and update. Do not copy secret server credentials into `EXPO_PUBLIC_*` variables.

OTA cannot add native libraries, change Android/iOS permissions or other native configuration, or change the Expo/React Native native runtime. Those changes require a new production build and users must install it. `runtimeVersion: { "policy": "appVersion" }` prevents an update from being delivered to builds with a different app version. `preview` builds receive only `preview` updates; `production` builds receive only `production` updates.

## Delivery proof Telegram setup

The Ways screen requires a camera proof before completing delivery. The proof is sent to a Telegram channel by the `deliver-with-proof` Supabase Edge Function, with the order's item ID and barcode in the caption. The order is marked Delivered only after Telegram accepts the photo.

1. Create a Telegram bot and add it as an administrator to the destination channel with permission to post messages.
2. Set the bot token and channel ID as Supabase secrets; do not add the bot token to the mobile app or commit it:

   ```sh
   npx supabase secrets set TELEGRAM_BOT_TOKEN=your-bot-token TELEGRAM_CHAT_ID=your-channel-id
   ```

3. Deploy the function from the linked Supabase project:

   ```sh
   npx supabase functions deploy deliver-with-proof
   ```

The function also requires Supabase's standard `SUPABASE_URL` and `SUPABASE_ANON_KEY` runtime variables. A Telegram delivery failure leaves the order On Way and is shown in the proof screen.

## Pickup proof Telegram setup

Completing a pickup now requires a camera photo. The `complete-pickup-with-proof` Supabase Edge Function reads the rider's `branch` from the `riders` table and sends the photo to that branch's Telegram channel. The caption contains the rider, branch, and sender names. It marks the pickup Picked Up only after Telegram accepts the photo; the existing pickup quantity is not changed.

1. Add the same Telegram bot as an administrator to the pickup channel with permission to post photos.
2. Set a JSON object mapping each exact `riders.branch` name to its channel ID as a Supabase secret. Keep the existing `TELEGRAM_BOT_TOKEN` secret; do not put channel IDs or the bot token in the mobile app:

   ```sh
   npx supabase secrets set 'TELEGRAM_PICKUP_CHANNELS={"Branch A":"-1001234567890","Branch B":"-1009876543210"}'
   ```

   Replace the example branch names and channel IDs with the values used by your `riders.branch` column and Telegram channels. Branch matching ignores leading/trailing spaces and letter case. Every rider branch that completes pickups must have a configured channel.

3. Deploy the pickup proof function from the linked Supabase project:

   ```sh
   npx supabase functions deploy complete-pickup-with-proof
   ```

A Telegram send failure leaves the pickup assigned and is shown in the pickup proof screen.

## Parcel intake setup

The native Parcel Intake screen calls the web intake server for order queries, R2 image uploads, and Telegram notifications. Set the web app's HTTPS origin in the Expo app environment:

Each newly created intake order is assigned to the signed-in rider for both pickup and delivery, starts with status `On Way`, and uses the received date as its delivery date.

```env
EXPO_PUBLIC_INTAKE_API_URL=https://your-intake-web-app.example.com
```

Keep the existing `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` values configured for the rider app. On the web server, configure `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, and `R2_PUBLIC_URL` (or `R2_PUBLIC_DOMAIN`). Also configure `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_MDY`, and `TELEGRAM_CHANNEL_YGN`; `TELEGRAM_DEFAULT_CHANNEL_ID` is an optional fallback. The web server also needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and a server-only `SUPABASE_SERVICE_ROLE_KEY` with order insert access.

On the Next.js deployment, set `INTAKE_ALLOWED_ORIGINS` to a comma-separated list of the Expo web origins allowed to call the intake APIs. For local web testing, include `http://localhost:8081` (and `http://127.0.0.1:8081` if used); include the deployed Expo web origin for production. This only configures browser CORS and does not replace server-side authentication.

Never put R2 credentials, Telegram credentials, or `SUPABASE_SERVICE_ROLE_KEY` in the Expo app or any `EXPO_PUBLIC_` variable. The referenced web API routes currently do not validate the bearer token sent by the mobile app; protect `/api/table`, `/api/upload-r2`, and `/api/telegram` with server-side authentication and authorization before exposing them publicly. Restart Expo after changing environment values.

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
