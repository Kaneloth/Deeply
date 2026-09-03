# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Required for Google Sign-In (via @capawesome/capacitor-google-sign-in,
# which uses Android's Credential Manager API under the hood). Without
# these, R8 can strip the Play Services implementation class Credential
# Manager needs at runtime — but only in this release/minified build,
# since debug builds have minifyEnabled false by default and never hit
# this. This exactly matches the reported symptom: works when locally
# built/sideloaded, fails specifically on the Play Store release, with
# the account picker opening and a real account getting selected before
# it silently fails right after — confirmed as a known, documented
# requirement directly in AndroidX's own credentials library source.
-if class androidx.credentials.CredentialManager
-keep class androidx.credentials.playservices.** { *; }