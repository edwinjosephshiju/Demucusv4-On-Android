#!/usr/bin/env python3
"""
DaVinci Resolve Studio 21 AI Remixer (Demucs v4)
Android Native Controller & App Launcher
"""

import os
import sys
import time
import subprocess
import urllib.request
import signal

PORT = 3000
SERVER_URL = f"http://127.0.0.1:{PORT}"
BROWSER_URL = f"http://localhost:{PORT}"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def is_server_running():
    """Check if the backend server is responding to health checks."""
    try:
        req = urllib.request.Request(f"{SERVER_URL}/api/system", headers={"User-Agent": "DemucsApp"})
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            return resp.status == 200
    except Exception:
        return False


def start_backend_server():
    """Starts the Node.js backend if it is not already active."""
    if is_server_running():
        print(f"[*] Node.js backend already active on {BROWSER_URL}")
        return None

    print("[*] Starting Node.js backend server (node server.js)...")
    proc = subprocess.Popen(
        ["node", "server.js"],
        cwd=SCRIPT_DIR,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        preexec_fn=os.setsid if hasattr(os, "setsid") else None
    )

    for _ in range(30):
        time.sleep(0.2)
        if is_server_running():
            print(f"[✓] Node.js backend server ready on {BROWSER_URL}")
            return proc

    print("[!] Backend server launched. Continuing...")
    return proc


def open_remixer_browser():
    """Opens the DaVinci Resolve Remixer in the default Android browser/PWA."""
    print(f"[*] Opening DaVinci Resolve Remixer at {BROWSER_URL}...")
    try:
        subprocess.run(["termux-open-url", BROWSER_URL], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except Exception:
        pass

    try:
        subprocess.run(
            ["am", "start", "-a", "android.intent.action.VIEW", "-d", BROWSER_URL],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        return True
    except Exception as e:
        print(f"[!] Could not launch browser intent automatically: {e}")
        return False


def launch_gui():
    server_proc = start_backend_server()

    # Launch browser interface immediately
    open_remixer_browser()

    print("\n=======================================================")
    print("  DaVinci Resolve Studio 21 - AI Music Remixer")
    print(f"  Local Dashboard: {BROWSER_URL}")
    print("  Engine: Demucs v4 (Multi-threaded ARM64 CPU)")
    print("=======================================================\n")

    # Connect to Termux:GUI for Native Android Activity
    try:
        import termuxgui as tg
        conn = tg.Connection()
    except Exception as e:
        print(f"[*] Termux:GUI notice ({e}).")
        print(f"[*] The DaVinci Resolve Remixer is running at: {BROWSER_URL}")
        print("    You can add it to your Home Screen in Chrome as a full-screen app!")
        print("    Press Ctrl+C to stop the backend server.")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n[*] Exiting...")
            return 0

    print("[*] Launching native DaVinci Resolve Control Activity in Termux:GUI...")
    try:
        activity = tg.Activity(conn, canceloutside=False)
        activity.keepscreenon(True)

        # DaVinci Resolve Fairlight Theme
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

        # Root layout
        root = tg.LinearLayout(activity, vertical=True)
        root.setmargin(20)

        # Title: DaVinci Resolve Studio 21
        title = tg.TextView(activity, "DaVinci Resolve Studio 21", parent=root)
        title.settextsize(20)
        title.settextcolor(0xFFFFFFFF)
        title.setmargin(10, dir="bottom")

        # Subtitle
        sub = tg.TextView(activity, "AI 4-STEM REMIXER • FAIRLIGHT ENGINE", parent=root)
        sub.settextsize(12)
        sub.settextcolor(0xFFFF7A00)
        sub.setmargin(15, dir="bottom")

        # Status text
        status_tv = tg.TextView(
            activity,
            "● SERVER ONLINE: http://localhost:3000\n"
            "• Engine: Demucs v4 ARM64 CPU\n"
            "• Model: htdemucs (Vocals, Drums, Bass, Other)",
            parent=root
        )
        status_tv.settextsize(14)
        status_tv.settextcolor(0xFF2ECC71)
        status_tv.setmargin(20, dir="bottom")

        # Primary Button: Open Remixer Studio
        btn_open = tg.Button(activity, "🎛️ OPEN REMIXER STUDIO (BROWSER / PWA)", parent=root)
        btn_open.settextcolor(0xFFFFFFFF)
        btn_open.setbackgroundcolor(0xFFFF7A00)
        btn_open.setmargin(10, dir="bottom")
        btn_open.sendclickevent(True)

        # Secondary Button: Restart Backend
        btn_restart = tg.Button(activity, "🔄 RESTART BACKEND ENGINE", parent=root)
        btn_restart.settextcolor(0xFFE6E6E8)
        btn_restart.setbackgroundcolor(0xFF2B2B30)
        btn_restart.setmargin(10, dir="bottom")
        btn_restart.sendclickevent(True)

        # Info Box
        info_tv = tg.TextView(
            activity,
            "\n💡 FULLSCREEN PWA TIP:\n"
            "In Chrome/browser, tap ⋮ (menu) → 'Add to Home screen' or 'Install App' "
            "to run DaVinci Resolve Remixer full-screen with no browser address bar!",
            parent=root
        )
        info_tv.settextsize(13)
        info_tv.settextcolor(0xFF8E8E93)
        info_tv.setmargin(25, dir="bottom")

        # Exit Button
        btn_exit = tg.Button(activity, "❌ EXIT REMIXER", parent=root)
        btn_exit.settextcolor(0xFFFF5252)
        btn_exit.setbackgroundcolor(0xFF1E1E21)
        btn_exit.sendclickevent(True)

        print("[✓] Native Android Activity is active.")
        print("    Press Ctrl+C in terminal or tap 'EXIT' in the app to quit.")

        # Event loop
        for ev in conn.events():
            if ev.type == tg.Event.click:
                if ev.id == btn_open.id:
                    print("[*] 'Open Remixer Studio' button clicked.")
                    open_remixer_browser()
                elif ev.id == btn_restart.id:
                    print("[*] 'Restart Backend' button clicked.")
                    status_tv.settext("⟳ Restarting backend engine...")
                    status_tv.settextcolor(0xFFFF7A00)
                    try:
                        subprocess.run(["pkill", "-f", "node server.js"], stdout=subprocess.DEVNULL)
                        time.sleep(1)
                        start_backend_server()
                        status_tv.settext(
                            "● SERVER ONLINE: http://localhost:3000\n"
                            "• Engine: Demucs v4 ARM64 CPU\n"
                            "• Model: htdemucs (Vocals, Drums, Bass, Other)"
                        )
                        status_tv.settextcolor(0xFF2ECC71)
                    except Exception as err:
                        status_tv.settext(f"[!] Restart error: {err}")
                elif ev.id == btn_exit.id:
                    print("[*] Exit button clicked.")
                    break
            elif ev.type in [tg.Event.destroy, tg.Event.back]:
                print("[*] Activity closed.")
                break

    except KeyboardInterrupt:
        print("\n[*] Exiting Termux:GUI app...")
    except Exception as e:
        print(f"[!] Termux:GUI activity error: {e}")
    finally:
        try:
            activity.finish()
        except Exception:
            pass

    return 0


if __name__ == "__main__":
    sys.exit(launch_gui())
