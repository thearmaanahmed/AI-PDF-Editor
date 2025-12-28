# Installs dependencies, adds the Android platform, and syncs the project.
# After running this script, open the project in Android Studio to build the APK.

# 1. Install NPM dependencies
npm install

# 2. Add the Android platform if not already added
if (-not (Test-Path -Path "./android")) {
    npx cap add android
}
npm audit fix --force



# 3. Synchronize with the Android platform to generate necessary files
npx cap sync android

Write-Host "Project setup complete. Now, open Android Studio and build the APK."
