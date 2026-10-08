#!/usr/bin/env python3
"""
DaVinci Resolve Studio 21 AI Remixer (Demucs v4)
Termux:GUI Native Android Activity & WebView Launcher
"""

import os
import sys
import time
import subprocess
import urllib.request
import signal

try:
    import termuxgui as tg
except ImportError:
    print("Error: termuxgui Python package is not installed.")
    print("Please install it with: pip install termuxgui")
    sys.exit(1)

import ssl

PORT = 3000
HTTPS_PORT = 3443
SERVER_URL = f"https://127.0.0.1:{HTTPS_PORT}"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# SSL context that allows local self-signed certificate
SSL_CTX = ssl._create_unverified_context()


def is_server_running():
    try:
        req = urllib.request.Request(f"{SERVER_URL}/api/system", headers={"User-Agent": "TermuxGUI"})
        with urllib.request.urlopen(req, timeout=1.5, context=SSL_CTX) as resp:
            return resp.status == 200
    except Exception:
        # Check HTTP fallback
        try:
            req = urllib.request.Request(f"http://127.0.0.1:{PORT}/api/system", headers={"User-Agent": "TermuxGUI"})
            with urllib.request.urlopen(req, timeout=1.0) as resp:
                return resp.status == 200
        except Exception:
            return False


def start_backend_server():
    if is_server_running():
        print(f"[*] Node.js backend already active on {SERVER_URL}")
        return None

    print(f"[*] Starting Node.js backend server (node server.js)...")
    proc = subprocess.Popen(
        ["node", "server.js"],
        cwd=SCRIPT_DIR,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        preexec_fn=os.setsid if hasattr(os, "setsid") else None
    )

    # Wait up to 6 seconds for server to be responsive
    for _ in range(30):
        time.sleep(0.2)
        if is_server_running():
            print(f"[✓] Node.js backend server ready on {SERVER_URL}")
            return proc

    print("[!] Warning: Server started but taking longer to reply. Continuing to load GUI...")
    return proc


def launch_gui():
    server_proc = start_backend_server()

    print("[*] Connecting to Termux:GUI service...")
    try:
        conn = tg.Connection()
    except Exception as e:
        print(f"[✗] Failed to connect to Termux:GUI: {e}")
        print("\nPlease ensure:")
        print("  1. The Termux:GUI app is installed on your Android device.")
        print("  2. Termux:GUI has appeared or was opened at least once to grant permissions.")
        return 1

    print("[*] Creating native Android Activity...")
    try:
        # Create full-screen activity
        activity = tg.Activity(conn, canceloutside=False)

        # Intercept back button to navigate backwards in WebView
        activity.interceptbackbutton(True)
        # Keep screen on while mixing/separating audio
        activity.keepscreenon(True)

        # Set DaVinci Resolve dark theme
        # statusbar: #151517, primary: #1E1E21, window: #0F0F10, text: #E6E6E8, accent: #FF7A00
        try:
            activity.settheme(
                statusbarcolor=0xFF151517,
                colorprimary=0xFF1E1E21,
                windowbackground=0xFF0F0F10,
                textcolor=0xFFE6E6E8,
                coloraccent=0xFFFF7A00
            )
        except Exception:
            pass

        # Create full-screen WebView attached to the Activity
        webview = tg.WebView(activity)
        webview.setdimensions("MATCH_PARENT", "MATCH_PARENT")

        # Enable JavaScript and navigation for interactive controls
        try:
            webview.allowjavascript(True)
            webview.allownavigation(True)
        except Exception as e:
            print(f"[!] WebView configuration notice: {e}")

        # Load the DaVinci Resolve AI Remixer dashboard via HTTPS (bypasses Android cleartext restrictions)
        print(f"[*] Loading DaVinci Resolve Remixer in Termux:GUI WebView ({SERVER_URL})...")
        webview.loaduri(SERVER_URL)

        print("\n=======================================================")
        print("  DaVinci Resolve AI Remixer is now running in Termux:GUI!")
        print("  Press Ctrl+C in terminal or close the window to exit.")
        print("=======================================================\n")

        # Event loop to handle back button and activity destruction
        history_depth = 0
        for ev in conn.events():
            if ev.type == tg.Event.back:
                # If user taps Android back button, try going back in web history
                try:
                    webview.goback()
                except Exception:
                    activity.finish()
                    break
            elif ev.type == tg.Event.destroy:
                print("[*] GUI window closed by user.")
                break

    except KeyboardInterrupt:
        print("\n[*] Exiting Termux:GUI app...")
    finally:
        try:
            activity.finish()
        except Exception:
            pass

    return 0


if __name__ == "__main__":
    sys.exit(launch_gui())
