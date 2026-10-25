using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace UltimaSetup
{
    // The setup window: borderless and rounded, filled by the scene (ui/index.html) in WebView2. The scene drives
    // everything through messages; this side does the work and reports back.
    //   scene → here: ready, install {desktopShortcut}, closeApp, uninstall {deleteData}, launch, minimize, close, drag
    //   here → scene: hello {mode, product, version, installed, dir}, stage {name}, progress {value, file},
    //                 running, done, error {message}
    sealed class SetupWindow : Form
    {
        readonly Options options;
        readonly Installer installer;
        readonly Manifest m;
        readonly string dir;
        readonly JavaScriptSerializer json = new JavaScriptSerializer();
        WebView2 view;
        bool busy;
        bool desktopShortcut = true;

        public SetupWindow(Options options, Payload payload)
        {
            this.options = options;
            installer = new Installer(payload);
            m = payload.Manifest;
            dir = options.Dir ?? installer.InstalledDir() ?? installer.DefaultDir;

            Text = m.ProductName + (options.Uninstall ? " Uninstall" : " Setup");
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(5, 4, 12);
            ClientSize = new Size(1040, 640); // resized for the screen's scale once the window exists (OnHandleCreated)
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            installer.Stage += s => Post(new { type = "stage", name = s });
            installer.Progress += (f, file) => Post(new { type = "progress", value = f, file });
            Shown += async (s, e) => await StartSceneAsync();
        }

        // a shadow round the borderless window
        protected override CreateParams CreateParams
        {
            get { var cp = base.CreateParams; cp.ClassStyle |= 0x20000; return cp; }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            int round = 2, dark = 1; // Windows 11: rounded corners, dark frame
            DwmSetWindowAttribute(Handle, 33, ref round, 4);
            DwmSetWindowAttribute(Handle, 20, ref dark, 4);
            // The scene is laid out for 1040×640 at 100%; at 125% that's 1300×800 pixels. The screen's scale is only
            // known once the window exists (asking earlier gives 100% on a scaled display, and a scene 20% too small).
            int dpi = SafeDpi();
            ClientSize = new Size(1040 * dpi / 96, 640 * dpi / 96);
            CenterToScreen();
        }

        int SafeDpi() { try { return (int)GetDpiForWindow(Handle); } catch (EntryPointNotFoundException) { return DeviceDpi; } }

        // moved to a screen with another scale: take the size Windows suggests, so the scene keeps its proportions
        protected override void WndProc(ref Message msg)
        {
            const int WM_DPICHANGED = 0x02E0;
            if (msg.Msg == WM_DPICHANGED)
            {
                var r = (RECT)Marshal.PtrToStructure(msg.LParam, typeof(RECT));
                SetBounds(r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top);
                return;
            }
            base.WndProc(ref msg);
        }

        [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
        [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hwnd);

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (busy) e.Cancel = true; // never half-installed
            base.OnFormClosing(e);
        }

        async Task StartSceneAsync()
        {
            try { await CreateViewAsync(); }
            catch (Exception ex) when (ex is WebView2RuntimeNotFoundException || ex is DllNotFoundException || ex is BadImageFormatException || ex is COMException)
            {
                // No WebView2 on this PC (rare on Windows 10/11): plain setup instead
                Hide();
                BasicSetup.Run(options, installer, dir);
                Close();
            }
        }

        [MethodImpl(MethodImplOptions.NoInlining)] // WebView2 is loaded from inside the exe, after Main has set that up
        async Task CreateViewAsync()
        {
            var work = Program.WorkDir;
            CoreWebView2Environment.SetLoaderDllFolderPath(Path.Combine(work, "native"));
            var debugPort = Environment.GetEnvironmentVariable("ULTIMA_SETUP_DEBUG_PORT"); // for testing the scene over CDP
            var args = "--autoplay-policy=no-user-gesture-required" + (string.IsNullOrEmpty(debugPort) ? "" : " --remote-debugging-port=" + debugPort);
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(work, "webview"), new CoreWebView2EnvironmentOptions(args));
            view = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = BackColor };
            Controls.Add(view);
            await view.EnsureCoreWebView2Async(env);
            var w = view.CoreWebView2;
            w.Settings.AreDefaultContextMenusEnabled = false;
            w.Settings.AreDevToolsEnabled = !string.IsNullOrEmpty(debugPort);
            w.Settings.IsZoomControlEnabled = false;
            w.Settings.AreBrowserAcceleratorKeysEnabled = false;
            w.Settings.IsStatusBarEnabled = false;
            w.Settings.IsNonClientRegionSupportEnabled = true; // the scene's top bar (app-region: drag) moves the window
            w.SetVirtualHostNameToFolderMapping("setup.ultima", Path.Combine(work, "ui"), CoreWebView2HostResourceAccessKind.Deny);
            w.WebMessageReceived += OnMessage;
            w.NewWindowRequested += (s, e) => e.Handled = true;
            w.Navigate("https://setup.ultima/index.html");
        }

        void Post(object message)
        {
            if (IsDisposed || !IsHandleCreated) return;
            var text = json.Serialize(message);
            BeginInvoke(new Action(() => { try { view?.CoreWebView2?.PostWebMessageAsJson(text); } catch { /* closing */ } }));
        }

        void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            Dictionary<string, object> msg;
            try { msg = json.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson); } catch { return; }
            var type = msg.TryGetValue("type", out var t) ? t as string : null;
            switch (type)
            {
                case "ready":
                    Post(new
                    {
                        type = "hello",
                        mode = options.Uninstall ? "uninstall" : "install",
                        product = m.ProductName,
                        version = m.Version,
                        installed = installer.InstalledVersion(),
                        dir,
                    });
                    break;
                case "install":
                    desktopShortcut = !msg.TryGetValue("desktopShortcut", out var d) || !(d is bool b) || b;
                    if (installer.Running(dir).Length > 0) Post(new { type = "running" });
                    else Run(() => installer.Install(dir, desktopShortcut));
                    break;
                case "closeApp": // "Close Ultima and continue"
                    Run(() => { installer.CloseRunning(dir); installer.Install(dir, desktopShortcut); });
                    break;
                case "uninstall":
                    var deleteData = msg.TryGetValue("deleteData", out var dd) && dd is bool db && db;
                    Run(() => Installer.Uninstall(m, dir, deleteData));
                    break;
                case "launch":
                    try { installer.Launch(dir); } catch { }
                    Close();
                    break;
                case "minimize": WindowState = FormWindowState.Minimized; break;
                case "close": if (!busy) Close(); break;
                case "drag": ReleaseCapture(); SendMessage(Handle, 0xA1 /* WM_NCLBUTTONDOWN */, (IntPtr)2 /* HTCAPTION */, IntPtr.Zero); break;
            }
        }

        void Run(Action work)
        {
            if (busy) return;
            busy = true;
            Task.Run(() =>
            {
                try { work(); Post(new { type = "done" }); }
                catch (Exception ex) { Post(new { type = "error", message = Friendly(ex) }); }
                finally { busy = false; }
            });
        }

        static string Friendly(Exception ex)
        {
            if (ex is UnauthorizedAccessException || ex is IOException) return "A file is in use or can't be written. Close Ultima and anything using its folder, then try again. (" + ex.Message + ")";
            return ex.Message;
        }

        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
        [DllImport("user32.dll")] static extern bool ReleaseCapture();
        [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
    }
}
