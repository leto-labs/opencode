package app.tauri.foregroundservice

import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Build
import android.os.IBinder
import android.util.Log
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

private const val TAG = "ForegroundServicePlugin"

@TauriPlugin
class ForegroundServicePlugin(private val activity: Activity) : Plugin(activity) {

    private var foregroundService: ForegroundService? = null
    private var serviceBound = false

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            val binder = service as ForegroundService.LocalBinder
            foregroundService = binder.getService()
            serviceBound = true
            Log.d(TAG, "ForegroundService connected")
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            foregroundService = null
            serviceBound = false
            Log.d(TAG, "ForegroundService disconnected")
        }
    }

    @Command
    fun startService(invoke: Invoke) {
        try {
            if (serviceBound && foregroundService != null) {
                Log.d(TAG, "Foreground service already running")
                invoke.resolve()
                return
            }
            bindAndStartService()
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
            val intent = Intent(activity, ForegroundService::class.java)
            activity.stopService(intent)
            foregroundService = null
            Log.d(TAG, "Foreground service stopped")
            invoke.resolve()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to stop foreground service", e)
            invoke.reject("Failed to stop foreground service: ${e.message}")
        }
    }

    private fun bindAndStartService() {
        val intent = Intent(activity, ForegroundService::class.java)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            activity.startForegroundService(intent)
        } else {
            activity.startService(intent)
        }

        activity.bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE)
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

        val intent = Intent(activity, ForegroundService::class.java)
        activity.stopService(intent)

        Log.d(TAG, "ForegroundServicePlugin destroyed")
    }
}
