
# Generating the Android APK

Since you are on Windows, follow these steps to turn your code into an installable APK:

### 1. Setup Environment
* Install **Android Studio**.
* Ensure you have **Node.js** installed.
* Run `npm install` in your project folder.

### 2. Initialize Android Project
Run these commands in your terminal (PowerShell or CMD):
```powershell
# Install Capacitor Android platform
npm run android:add

# Sync your web code to the Android project
npm run android:sync
```

### 3. Build the APK
1. Run `npm run android:open`. This will launch **Android Studio**.
2. Wait for Gradle to finish indexing.
3. In Android Studio, go to the top menu: **Build** > **Build Bundle(s) / APK(s)** > **Build APK(s)**.
4. Once finished, a notification will appear. Click **Locate** to find your `app-debug.apk`.

### 4. Permissions Notice
The `AndroidManifest.xml` (located in `android/app/src/main/`) will automatically include Internet and Storage permissions. If you use the AI Camera scan feature, Android Studio will prompt you to add the Camera permission during the build.
