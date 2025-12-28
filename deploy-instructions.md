
# Deploying Architect Pro to Google Cloud

Follow these steps from your Windows environment to deploy the application:

### 1. Prerequisites
* Install the [Google Cloud SDK (gcloud CLI)](https://cloud.google.com/sdk/docs/install).
* Initialize the CLI: `gcloud init`
* Enable necessary services:
  ```powershell
  gcloud services enable run.googleapis.com cloudbuild.googleapis.com containerregistry.googleapis.com generativelanguage.googleapis.com
  ```

### 2. Deployment Command
Run the following command in your project root. Replace `YOUR_API_KEY` with your actual Gemini API key:

```powershell
gcloud builds submit --config cloudbuild.yaml --substitutions=_API_KEY="YOUR_API_KEY"
```

### 3. Accessing the App
Once the command finishes, it will provide a **Service URL** (e.g., `https://pdf-architect-xyz.a.run.app`). This is your live, production-grade AI PDF editor.

### 4. Continuous Deployment
For production, you can connect your GitHub repository to Cloud Run in the GCP Console to trigger a new build every time you push code.
