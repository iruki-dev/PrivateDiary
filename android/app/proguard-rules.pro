# R8 shrinks and obfuscates the release build. Nothing in this app is
# reached by reflection: the WebView bridge is a WebMessageListener (an
# interface object passed in code), not @JavascriptInterface methods looked
# up by name, so no keep rules are needed for it.

# Strip logging from release builds entirely — nothing the app logs should
# ever reach logcat on a user's phone.
-assumenosideeffects class android.util.Log {
    public static int v(...);
    public static int d(...);
    public static int i(...);
    public static int w(...);
    public static int e(...);
}
