# 🚀 Architect Pro: Android Studio Build Master Guide

Follow these steps to generate your production-ready APK on Windows.

## 1. Prerequisites (Checklist)
* **Node.js**: [Download](https://nodejs.org/) (LTS version).
* **Android Studio**: [Download](https://developer.android.com/studio).
* **Java Development Kit (JDK)**: Android Studio typically bundles this, but ensure you have **JDK 17** installed for modern Gradle versions.
* **Environment Variables**: Ensure `ANDROID_HOME` is set to your SDK location 
(usually `C:\Users\YourUser\AppData\Local\Android\Sdk`).

## 2. Preparing the Source
Run these commands in your project root:
```powershell
# 1. Install dependencies
npm install

# 2. Build your web project (ensure index.html is in the root)
# Note: If you have a build step (like Vite/Webpack), run that first.

# 3. Synchronize with the Android platform
npx cap sync android
```

## 3. Building in Android Studio
1. **Open the Project**:
   - Run `npx cap open android`.
   - Android Studio will launch. If it asks to "Import Gradle Project", click **Yes**.
2. **The Initial Sync**:
   - Look at the bottom of Android Studio. You will see a "Gradle Sync" progress bar. **Wait for this to finish completely.**
   - If you see a "Gradle Update Recommended" prompt, you can usually accept it.
3. **Generating the APK**:
   - In the top menu bar, go to: **Build** > **Build Bundle(s) / APK(s)** > **Build APK(s)**.
   - Android Studio will start compiling. This takes 1-3 minutes.
4. **Locate the File**:
   - A small pop-up will appear in the bottom-right corner when done.
   - Click **"locate"**.
   - Your file is named `app-debug.apk`.

## 4. Troubleshooting Common Errors
* **"JDK not found"**: Go to `File > Settings > Build, Execution, Deployment > Build Tools > Gradle` and ensure the "Gradle JDK" points to a valid JDK 17.
* **"Manifest merger failed"**: This usually happens if there is a conflict in `metadata.json`. Check the `android/app/src/main/AndroidManifest.xml` and ensure permissions are correct.
* **"Webview not found"**: On older Android emulators, ensure the "Android System WebView" is updated via the Play Store.

## 5. Deployment
Transfer the `app-debug.apk` to your phone via USB or Google Drive, then tap it to install!
