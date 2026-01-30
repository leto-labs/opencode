// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

package app.tauri.audiobridge

import android.Manifest
import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder
import android.util.Log
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

private const val TAG = "AudioBridgePlugin"
private const val PERMISSION_ALIAS_MICROPHONE = "microphone"
private const val PERMISSION_ALIAS_NOTIFICATIONS = "notifications"

@InvokeArg
class AudioConfig {
    var sampleRate: Int = 16000
    var channels: Int = 1
}

@InvokeArg
class AudioDataPayload {
    lateinit var data: List<Int>
    var sampleRate: Int = 16000
    var channels: Int = 1
}

@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = PERMISSION_ALIAS_MICROPHONE),
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = PERMISSION_ALIAS_NOTIFICATIONS)
    ]
)
class AudioBridgePlugin(private val activity: Activity) : Plugin(activity) {

    private var audioCaptureService: AudioCaptureService? = null
    private var serviceBound = false
    private var audioPlayer: AudioPlayer? = null

    private var pendingStartInvoke: Invoke? = null
    private var pendingConfig: AudioConfig? = null

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            val binder = service as AudioCaptureService.LocalBinder
            audioCaptureService = binder.getService()
            serviceBound = true
            Log.d(TAG, "AudioCaptureService connected")

            // If there's a pending start request, execute it now
            pendingStartInvoke?.let { invoke ->
                pendingConfig?.let { config ->
                    startCaptureWithService(invoke, config)
                }
                pendingStartInvoke = null
                pendingConfig = null
            }
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            audioCaptureService = null
            serviceBound = false
            Log.d(TAG, "AudioCaptureService disconnected")
        }
    }

    override fun load(webView: WebView) {
        super.load(webView)
        audioPlayer = AudioPlayer()
        Log.d(TAG, "AudioBridgePlugin loaded")
    }

    private fun getPermissionState(): String {
        return when {
            ContextCompat.checkSelfPermission(
                activity,
                Manifest.permission.RECORD_AUDIO
            ) == PackageManager.PERMISSION_GRANTED -> "granted"
            ActivityCompat.shouldShowRequestPermissionRationale(
                activity,
                Manifest.permission.RECORD_AUDIO
            ) -> "denied"
            else -> "prompt"
        }
    }

    @Command
    override fun checkPermissions(invoke: Invoke) {
        val result = JSObject()
        result.put("microphone", getPermissionState())
        invoke.resolve(result)
    }

    @Command
    override fun requestPermissions(invoke: Invoke) {
        val state = getPermissionState()
        if (state == "prompt") {
            requestPermissionForAlias(PERMISSION_ALIAS_MICROPHONE, invoke, "permissionCallback")
        } else {
            val result = JSObject()
            result.put("microphone", state)
            invoke.resolve(result)
        }
    }

    @PermissionCallback
    private fun permissionCallback(invoke: Invoke) {
        val result = JSObject()
        result.put("microphone", getPermissionState())
        invoke.resolve(result)
    }

    @Command
    fun startService(invoke: Invoke) {
        try {
            if (serviceBound && audioCaptureService != null) {
                Log.d(TAG, "Foreground service already running")
                invoke.resolve()
                return
            }
            bindAndStartService()
            // Service will start asynchronously; resolve immediately
            // The foreground notification + wake lock activate in onStartCommand
            Log.d(TAG, "Foreground service starting")
            invoke.resolve()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start foreground service", e)
            invoke.reject("Failed to start foreground service: ${e.message}")
        }
    }

    @Command
    fun stopService(invoke: Invoke) {
        try {
            if (serviceBound) {
                activity.unbindService(serviceConnection)
                serviceBound = false
            }
            val intent = Intent(activity, AudioCaptureService::class.java)
            activity.stopService(intent)
            audioCaptureService = null
            Log.d(TAG, "Foreground service stopped")
            invoke.resolve()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to stop foreground service", e)
            invoke.reject("Failed to stop foreground service: ${e.message}")
        }
    }

    @Command
    fun startCapture(invoke: Invoke) {
        val state = getPermissionState()
        if (state != "granted") {
            invoke.reject("Microphone permission not granted")
            return
        }

        val config = invoke.parseArgs(AudioConfig::class.java)

        if (serviceBound && audioCaptureService != null) {
            startCaptureWithService(invoke, config)
        } else {
            // Store pending request and bind to service
            pendingStartInvoke = invoke
            pendingConfig = config
            bindAndStartService()
        }
    }

    private fun bindAndStartService() {
        val intent = Intent(activity, AudioCaptureService::class.java)

        // Start as foreground service first (required for Android 8+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            activity.startForegroundService(intent)
        } else {
            activity.startService(intent)
        }

        // Then bind to it
        activity.bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE)
    }

    private fun startCaptureWithService(invoke: Invoke, config: AudioConfig) {
        try {
            audioCaptureService?.startCapture(
                sampleRate = config.sampleRate,
                channels = config.channels
            ) { audioData ->
                // Send audio data to frontend
                sendAudioData(audioData, config.sampleRate, config.channels)
            }
            Log.d(TAG, "Audio capture started (sampleRate: ${config.sampleRate}, channels: ${config.channels})")
            invoke.resolve()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start audio capture", e)
            invoke.reject("Failed to start audio capture: ${e.message}")
        }
    }

    @Command
    fun stopCapture(invoke: Invoke) {
        try {
            audioCaptureService?.stopCapture()

            // Unbind and stop service
            if (serviceBound) {
                activity.unbindService(serviceConnection)
                serviceBound = false
            }

            val intent = Intent(activity, AudioCaptureService::class.java)
            activity.stopService(intent)

            audioCaptureService = null
            Log.d(TAG, "Audio capture stopped")
            invoke.resolve()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to stop audio capture", e)
            invoke.reject("Failed to stop audio capture: ${e.message}")
        }
    }

    @Command
    fun playAudio(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(AudioDataPayload::class.java)

            // Convert List<Int> to ShortArray (Int16)
            val shortArray = ShortArray(args.data.size) { args.data[it].toShort() }

            audioPlayer?.play(
                data = shortArray,
                sampleRate = args.sampleRate,
                channels = args.channels
            ) {
                // Playback finished callback
                activity.runOnUiThread {
                    trigger("playbackFinished", JSObject())
                }
            }

            invoke.resolve()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to play audio", e)
            invoke.reject("Failed to play audio: ${e.message}")
        }
    }

    private fun sendAudioData(data: ShortArray, sampleRate: Int, channels: Int) {
        activity.runOnUiThread {
            val payload = JSObject()
            // Convert ShortArray to List<Int> for JSON serialization
            val dataList = data.map { it.toInt() }
            payload.put("data", dataList)
            payload.put("sampleRate", sampleRate)
            payload.put("channels", channels)
            trigger("audioData", payload)
        }
    }

    override fun onDestroy() {
        super.onDestroy()

        if (serviceBound) {
            try {
                activity.unbindService(serviceConnection)
            } catch (e: Exception) {
                Log.w(TAG, "Error unbinding service", e)
            }
            serviceBound = false
        }

        // Stop the foreground service
        val intent = Intent(activity, AudioCaptureService::class.java)
        activity.stopService(intent)

        audioPlayer?.release()
        audioPlayer = null

        Log.d(TAG, "AudioBridgePlugin destroyed")
    }
}
