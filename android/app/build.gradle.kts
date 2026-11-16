plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "app.popotso.fileupload"
    compileSdk = 35
    defaultConfig {
        applicationId = "app.popotso.fileupload"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        buildConfigField("String", "SUPABASE_URL", "\"https://huibmbswaawgmttbohsq.supabase.co\"")
        buildConfigField("String", "SUPABASE_ANON_KEY", "\"REPLACE_WITH_SUPABASE_PUBLISHABLE_KEY\"")
    }
    buildFeatures { buildConfig = true }
}
dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
}
