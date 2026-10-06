import com.android.build.api.artifact.SingleArtifact
import java.util.Properties
import java.util.zip.ZipFile
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/**
 * The web app, built as static files by `pnpm build:android-web`
 * (scripts/build-android-web.mjs) and bundled into the APK as assets.
 * Everything the app runs ships inside the signed APK — no page or script
 * is ever fetched from a server.
 */
val webAssetsDir = layout.buildDirectory.dir("generated/webAssets")

/** Optional build inputs, read from the environment so nothing secret lives in the repo. */
fun env(name: String): String? = providers.environmentVariable(name).orNull?.takeIf { it.isNotBlank() }

/**
 * Versioning (android/README.md → "버전 관리"):
 *  - versionName: android/version.properties, bumped by hand.
 *  - versionCode: ANDROID_VERSION_CODE, set by the distribution workflow to
 *    a number that only ever goes up. Local builds default to 1 — they're
 *    for this machine, never for testers.
 *  - BUILD_COMMIT: the commit a build came from, shown in the app so a
 *    tester's report points at exact code.
 */
val versionProps = Properties().apply {
    rootProject.file("version.properties").inputStream().use { load(it) }
}
val appVersionName: String = versionProps.getProperty("versionName")
    ?.takeIf { Regex("""\d+\.\d+\.\d+""").matches(it) }
    ?: error("android/version.properties: versionName must look like 1.2.3")
val appVersionCode: Int = env("ANDROID_VERSION_CODE")?.let {
    it.toIntOrNull()?.takeIf { code -> code in 1..2_100_000_000 }
        ?: error("ANDROID_VERSION_CODE must be a positive integer, got '$it'")
} ?: 1
val buildCommit: String = env("GITHUB_SHA")?.take(7)
    ?: providers.exec {
        commandLine("git", "rev-parse", "--short=7", "HEAD")
        isIgnoreExitValue = true
    }.standardOutput.asText.get().trim().ifEmpty { "local" }

android {
    namespace = "dev.iruki.privatediary"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.iruki.privatediary"
        // Android 11+: per-use biometric keys (setUserAuthenticationParameters),
        // scoped storage and the modern WebView feature set are all present,
        // so none of the protections below has a weaker fallback path.
        minSdk = 30
        targetSdk = 36
        versionCode = appVersionCode
        versionName = appVersionName
        buildConfigField("String", "BUILD_COMMIT", "\"$buildCommit\"")

        // The OAuth "Web client" ID of the Firebase project (Firebase console →
        // Authentication → Sign-in method → Google → Web SDK configuration).
        // Without it the app hides "Google로 계속하기"; email accounts work regardless.
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"${env("GOOGLE_WEB_CLIENT_ID") ?: ""}\"")
    }

    signingConfigs {
        // Release signing comes from the environment (CI secrets or a local
        // shell), never from a file in the repo. Without it, assembleRelease
        // produces an unsigned APK to be signed separately.
        val storeFile = env("ANDROID_KEYSTORE_PATH")
        if (storeFile != null) {
            create("release") {
                this.storeFile = file(storeFile)
                storePassword = env("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = env("ANDROID_KEY_ALIAS")
                keyPassword = env("ANDROID_KEY_PASSWORD")
                enableV1Signing = false
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
        debug {
            // Installs beside the release app instead of replacing it, so a
            // debug build (with WebView inspection on) never touches the real
            // app's data.
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    sourceSets["main"].assets.srcDir(webAssetsDir)

    androidResources {
        // aapt's default pattern silently drops every asset directory whose
        // name starts with "_" ("<dir>_*") — which is Next.js' `_next/`, i.e.
        // all of the app's JavaScript and CSS. Without this the APK shipped
        // bare HTML. Same list as the default, minus "<dir>_*" (".*" stays:
        // no dotfiles belong in the bundle).
        ignoreAssetsPattern = "!.svn:!.git:!.ds_store:!*.scc:.*:!CVS:!thumbs.db:!picasa.ini:!*~"
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // Google Play adds an encrypted block listing the app's dependencies to
    // the APK when this is on. Nothing in it is needed by the app.
    dependenciesInfo {
        includeInApk = false
        includeInBundle = false
    }

    packaging {
        resources {
            excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "/META-INF/*.version", "DebugProbesKt.bin")
        }
    }

    lint {
        // Newer AndroidX releases need compileSdk 37 (and a newer Android
        // Gradle Plugin); these are the newest that build against API 36.
        disable += setOf("GradleDependency", "NewerVersionAvailable")
        abortOnError = true
        checkReleaseBuilds = true
        warningsAsErrors = false
    }

    testOptions {
        unitTests.isReturnDefaultValues = false
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

val checkWebAssets by tasks.registering {
    description = "Fails early if the web bundle hasn't been built."
    val index = webAssetsDir.map { it.file("web/index.html") }
    doLast {
        check(index.get().asFile.exists()) {
            "Web bundle missing. Run `pnpm build:android-web` in the repository root first."
        }
    }
}
tasks.named("preBuild") { dependsOn(checkWebAssets) }

/**
 * After packaging, every file of the web bundle must actually be inside the
 * APK. Packaging rules can drop assets silently (aapt's default ignore list
 * once dropped all of `_next/`, shipping pages with no JS or CSS), and
 * nothing else would notice until the app was opened on a phone.
 */
androidComponents {
    onVariants { variant ->
        val variantName = variant.name.replaceFirstChar { it.uppercase() }
        val apkDir = variant.artifacts.get(SingleArtifact.APK)
        val loader = variant.artifacts.getBuiltArtifactsLoader()
        val bundle = webAssetsDir.map { it.dir("web") }
        val verify = tasks.register("verify${variantName}WebAssets") {
            description = "Checks that the ${variant.name} APK contains the whole web bundle."
            inputs.files(apkDir)
            inputs.dir(bundle)
            doLast {
                val root = bundle.get().asFile
                val expected = root.walkTopDown().filter { it.isFile }
                    .map { "assets/web/" + it.relativeTo(root).invariantSeparatorsPath }
                    .toSortedSet()
                val apks = loader.load(apkDir.get())?.elements.orEmpty()
                check(apks.isNotEmpty()) { "No APK produced for ${variant.name}" }
                apks.forEach { apk ->
                    val packaged = ZipFile(apk.outputFile).use { zip ->
                        zip.entries().asSequence().map { it.name }.toSet()
                    }
                    val missing = expected - packaged
                    check(missing.isEmpty()) {
                        "${missing.size} web files are missing from ${apk.outputFile}, e.g. " +
                            missing.take(5).joinToString()
                    }
                }
                logger.lifecycle("${expected.size} web files verified in the ${variant.name} APK")
            }
        }
        afterEvaluate {
            tasks.named("assemble$variantName") { finalizedBy(verify) }
        }
    }
}

dependencies {
    // WebViewAssetLoader (serves the bundled pages from a secure https
    // origin), WebMessageListener (origin-checked JS bridge) and the
    // WebView hardening switches below.
    implementation("androidx.webkit:webkit:1.17.1")
    // BiometricPrompt bound to a Keystore key (CryptoObject).
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("androidx.fragment:fragment-ktx:1.8.9")
    implementation("androidx.activity:activity-ktx:1.12.4")
    implementation("androidx.core:core-ktx:1.18.0")
    implementation("androidx.core:core-splashscreen:1.0.1")
    // Google sign-in. Google refuses OAuth inside WebViews, so the app gets
    // a Google ID token natively and hands only that token to Firebase Auth.
    implementation("androidx.credentials:credentials:1.5.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.5.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")

    testImplementation("junit:junit:4.13.2")
    // org.json is part of Android itself, but not of the JVM unit-test classpath.
    testImplementation("org.json:json:20260814")
}
