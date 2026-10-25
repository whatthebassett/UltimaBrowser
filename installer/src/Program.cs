using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Windows.Forms;

namespace UltimaSetup
{
    // Command line:
    //   (none)                       install, with the cinematic scene
    //   --silent                     install without any window (exit code 0 = installed)
    //   --dir "<folder>"             install there instead of %LOCALAPPDATA%\Programs\Ultima Browser
    //   --no-desktop-shortcut        skip the desktop shortcut
    //   --launch                     start Ultima when done (silent installs)
    //   --uninstall [--silent] [--delete-data]   what "Uninstall Ultima Browser.exe" runs (Settings → Apps)
    public sealed class Options
    {
        public bool Silent, Uninstall, FromTemp, DeleteData, Launch, DesktopShortcut = true;
        public string Dir;

        public static Options Parse(string[] args)
        {
            var o = new Options();
            for (int i = 0; i < args.Length; i++)
            {
                switch (args[i].ToLowerInvariant().TrimStart('-', '/'))
                {
                    case "s": case "silent": case "quiet": o.Silent = true; break;
                    case "uninstall": o.Uninstall = true; break;
                    case "from-temp": o.FromTemp = true; break;
                    case "delete-data": o.DeleteData = true; break;
                    case "launch": o.Launch = true; break;
                    case "no-desktop-shortcut": o.DesktopShortcut = false; break;
                    case "dir": if (i + 1 < args.Length) o.Dir = args[++i]; break;
                }
            }
            return o;
        }
    }

    static class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
            var o = Options.Parse(args);
            AppDomain.CurrentDomain.AssemblyResolve += LoadEmbeddedAssembly;
            var exe = Application.ExecutablePath;

            Payload payload = null;
            try { payload = Payload.Open(exe); } catch { /* reported below */ }
            if (payload == null)
            {
                if (!o.Silent) MessageBox.Show("This setup file is incomplete or damaged. Please download it again.", "Ultima Browser Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 2;
            }

            // The uninstaller lives in the folder it removes, so it hands over to a copy of itself in Temp
            if (o.Uninstall && !o.FromTemp)
            {
                var copy = Path.Combine(Path.GetTempPath(), "Ultima Browser Uninstall " + Guid.NewGuid().ToString("N").Substring(0, 8) + ".exe");
                File.Copy(exe, copy, true);
                var dir = o.Dir ?? Path.GetDirectoryName(exe);
                var rest = string.Join(" ", args.Select(Quote));
                var p = Process.Start(new ProcessStartInfo(copy, rest + " --from-temp --dir " + Quote(dir)) { UseShellExecute = false });
                if (o.Silent) { p.WaitForExit(); return p.ExitCode; }
                return 0;
            }

            int code;
            if (o.Silent) code = RunSilent(o, payload);
            else
            {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new SetupWindow(o, payload));
                code = 0;
            }
            if (o.FromTemp)
            {
                DeleteSelfLater(exe);
                // what's left of the folder is the uninstaller that handed over to us, waiting for us to finish
                if (Installer.Uninstalled && o.Dir != null && Directory.Exists(o.Dir)) DeleteLater(o.Dir, true);
            }
            CleanUpWorkDir();
            return code;
        }

        static int RunSilent(Options o, Payload payload)
        {
            try
            {
                var installer = new Installer(payload);
                var dir = o.Dir ?? installer.InstalledDir() ?? installer.DefaultDir;
                if (o.Uninstall) Installer.Uninstall(payload.Manifest, dir, o.DeleteData);
                else
                {
                    installer.CloseRunning(dir);
                    installer.Install(dir, o.DesktopShortcut);
                    if (o.Launch) installer.Launch(dir);
                }
                return 0;
            }
            catch (Exception ex)
            {
                try { File.AppendAllText(Path.Combine(Path.GetTempPath(), "UltimaSetup.log"), DateTime.Now + " " + ex + Environment.NewLine); } catch { }
                return 1;
            }
        }

        // ---- files that travel inside the exe ----
        static string workDir;

        // The scene (ui/) and WebView2's loader, unpacked once to a temp folder of this run
        public static string WorkDir
        {
            get
            {
                if (workDir != null) return workDir;
                workDir = Path.Combine(Path.GetTempPath(), "UltimaSetup-" + Guid.NewGuid().ToString("N").Substring(0, 8));
                var asm = Assembly.GetExecutingAssembly();
                foreach (var name in asm.GetManifestResourceNames().Where(n => n.StartsWith("ui/") || n.StartsWith("native/")))
                {
                    var target = Path.Combine(workDir, name.Replace('/', '\\'));
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    using (var src = asm.GetManifestResourceStream(name))
                    using (var dst = File.Create(target)) src.CopyTo(dst);
                }
                return workDir;
            }
        }

        static void CleanUpWorkDir()
        {
            if (workDir == null) return;
            try { Directory.Delete(workDir, true); }
            catch { DeleteLater(workDir, true); } // WebView2 may still hold its files for a moment
        }

        static Assembly LoadEmbeddedAssembly(object sender, ResolveEventArgs e)
        {
            var name = "lib/" + new AssemblyName(e.Name).Name + ".dll";
            using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
            {
                if (s == null) return null;
                var bytes = new byte[s.Length];
                s.Read(bytes, 0, bytes.Length);
                return Assembly.Load(bytes);
            }
        }

        static void DeleteSelfLater(string exe) => DeleteLater(exe, false);

        static void DeleteLater(string path, bool dir)
        {
            var cmd = "/c ping 127.0.0.1 -n 4 > nul & " + (dir ? "rmdir /s /q " : "del /f /q ") + Quote(path);
            try { Process.Start(new ProcessStartInfo("cmd.exe", cmd) { CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden }); } catch { }
        }

        static string Quote(string s) => s.Contains(" ") || s.Contains("\"") ? "\"" + s.Replace("\"", "\\\"") + "\"" : s;
    }
}
