using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using Microsoft.Win32;

namespace UltimaSetup
{
    // Installs Ultima for the current user (no admin rights): %LOCALAPPDATA%\Programs\Ultima Browser, Start menu and
    // desktop shortcuts, and an entry in Settings → Apps with an uninstaller. Uninstalling removes all of that, and the
    // default-browser registration Ultima writes (src/main/defaultbrowser.js); browsing data stays unless asked.
    public sealed class Installer
    {
        public const string UninstallerName = "Uninstall Ultima Browser.exe";
        readonly Manifest m;
        readonly Payload payload;

        public Installer(Payload payload) { this.payload = payload; m = payload.Manifest; }

        public event Action<double, string> Progress; // 0..1, the file being written
        public event Action<string> Stage;            // prepare, copy, finish

        public Manifest Manifest => m;
        public string DefaultDir => System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", m.ProductName);
        string UninstallKey => @"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + m.RegistryKey;
        static string StartMenuLink(Manifest m) => System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), m.ProductName + ".lnk");
        static string DesktopLink(Manifest m) => System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), m.ProductName + ".lnk");
        public static string DataDir(Manifest m) => System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), m.ProductName);

        // The version already installed, if any (from Settings → Apps)
        public string InstalledVersion()
        {
            using (var k = Registry.CurrentUser.OpenSubKey(UninstallKey)) return k?.GetValue("DisplayVersion") as string;
        }

        public string InstalledDir()
        {
            using (var k = Registry.CurrentUser.OpenSubKey(UninstallKey)) return k?.GetValue("InstallLocation") as string;
        }

        public Process[] Running(string dir) => Running(m, dir);
        public void CloseRunning(string dir) => CloseRunning(m, dir);

        // Ultima running from that folder (its files can't be replaced or removed while it is)
        static Process[] Running(Manifest m, string dir)
        {
            var name = System.IO.Path.GetFileNameWithoutExtension(m.ExeName);
            return Process.GetProcessesByName(name).Where(p =>
            {
                try { return p.MainModule.FileName.StartsWith(dir.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase); }
                catch { return true; } // can't tell: count it, it's named like Ultima
            }).ToArray();
        }

        static void CloseRunning(Manifest m, string dir)
        {
            foreach (var p in Running(m, dir))
            {
                try
                {
                    p.CloseMainWindow();
                    if (!p.WaitForExit(5000)) { p.Kill(); p.WaitForExit(5000); }
                }
                catch { /* already gone */ }
            }
        }

        public void Install(string dir, bool desktopShortcut)
        {
            if (!payload.HasApp) throw new InvalidOperationException("This installer doesn't contain Ultima. Build it with npm run dist:setup.");
            Stage?.Invoke("prepare");
            Clear(dir);
            Directory.CreateDirectory(dir);

            Stage?.Invoke("copy");
            using (var zipStream = payload.OpenZip())
            using (var zip = new ZipArchive(zipStream, ZipArchiveMode.Read))
            {
                long total = Math.Max(1, zip.Entries.Sum(e => e.Length));
                long done = 0;
                double reported = -1;
                var root = System.IO.Path.GetFullPath(dir).TrimEnd('\\') + "\\";
                var buffer = new byte[1 << 20];
                foreach (var entry in zip.Entries)
                {
                    var target = System.IO.Path.GetFullPath(System.IO.Path.Combine(dir, entry.FullName));
                    if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue; // nothing may land outside the folder
                    if (entry.FullName.EndsWith("/") || entry.FullName.EndsWith("\\")) { Directory.CreateDirectory(target); continue; }
                    Directory.CreateDirectory(System.IO.Path.GetDirectoryName(target));
                    using (var src = entry.Open())
                    using (var dst = new FileStream(target, FileMode.Create, FileAccess.Write, FileShare.None, buffer.Length))
                    {
                        int n;
                        while ((n = src.Read(buffer, 0, buffer.Length)) > 0)
                        {
                            dst.Write(buffer, 0, n);
                            done += n;
                            double f = (double)done / total;
                            if (f - reported >= 0.004) { reported = f; Progress?.Invoke(f, entry.FullName); }
                        }
                    }
                    File.SetLastWriteTime(target, entry.LastWriteTime.DateTime);
                }
                Progress?.Invoke(1, "");
            }

            Stage?.Invoke("finish");
            var exe = System.IO.Path.Combine(dir, m.ExeName);
            payload.WriteUninstaller(System.IO.Path.Combine(dir, UninstallerName));
            ShellLink.Create(StartMenuLink(m), exe, dir, "Browse with Ultima", m.AppId);
            if (desktopShortcut) ShellLink.Create(DesktopLink(m), exe, dir, "Browse with Ultima", m.AppId);
            else TryDelete(DesktopLink(m));
            using (var k = Registry.CurrentUser.CreateSubKey(UninstallKey))
            {
                var uninstaller = "\"" + System.IO.Path.Combine(dir, UninstallerName) + "\" --uninstall";
                k.SetValue("DisplayName", m.ProductName);
                k.SetValue("DisplayVersion", m.Version);
                k.SetValue("Publisher", m.Publisher);
                k.SetValue("DisplayIcon", exe + ",0");
                k.SetValue("InstallLocation", dir);
                k.SetValue("UninstallString", uninstaller);
                k.SetValue("QuietUninstallString", uninstaller + " --silent");
                k.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
                k.SetValue("EstimatedSize", (int)Math.Min(int.MaxValue, DirSize(dir) / 1024), RegistryValueKind.DWord);
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
        }

        public void Launch(string dir)
        {
            Process.Start(new ProcessStartInfo(System.IO.Path.Combine(dir, m.ExeName)) { WorkingDirectory = dir, UseShellExecute = true });
        }

        // Set once Uninstall has run: the folder's last file (the uninstaller that started it, still waiting) is
        // removed after this process exits (see Program.Main).
        public static bool Uninstalled { get; private set; }

        public static void Uninstall(Manifest m, string dir, bool deleteData)
        {
            CloseRunning(m, dir);
            TryDelete(StartMenuLink(m));
            TryDelete(DesktopLink(m));
            Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + m.RegistryKey, false);
            // what Ultima registers when it's made the default browser (keep in step with defaultbrowser.js)
            Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\UltimaHTML", false);
            Registry.CurrentUser.DeleteSubKeyTree(@"Software\Clients\StartMenuInternet\UltimaBrowser", false);
            using (var k = Registry.CurrentUser.OpenSubKey(@"Software\RegisteredApplications", true)) k?.DeleteValue(m.ProductName, false);
            Clear(dir);
            TryDeleteDir(dir);
            if (deleteData) TryDeleteDir(DataDir(m));
            Uninstalled = true;
        }

        // Empties an install folder, but only one that is plainly Ultima's: never a drive, a profile folder, or a
        // folder holding something else.
        static void Clear(string dir)
        {
            if (!Directory.Exists(dir)) return;
            var full = System.IO.Path.GetFullPath(dir).TrimEnd('\\');
            var name = System.IO.Path.GetFileName(full);
            bool ours = name.IndexOf("Ultima", StringComparison.OrdinalIgnoreCase) >= 0
                && (File.Exists(System.IO.Path.Combine(full, "Ultima Browser.exe")) || File.Exists(System.IO.Path.Combine(full, UninstallerName))
                    || !Directory.EnumerateFileSystemEntries(full).Any());
            if (!ours || full.Length <= 3) throw new InvalidOperationException("“" + full + "” doesn't look like an Ultima folder, so Setup won't empty it.");
            foreach (var f in Directory.GetFiles(full)) DeleteWithRetry(f);
            foreach (var d in Directory.GetDirectories(full)) DeleteDirWithRetry(d);
        }

        static void DeleteWithRetry(string f)
        {
            for (int i = 0; ; i++)
            {
                try { File.SetAttributes(f, FileAttributes.Normal); File.Delete(f); return; }
                catch (UnauthorizedAccessException) when (System.IO.Path.GetFileName(f).Equals(UninstallerName, StringComparison.OrdinalIgnoreCase)) { return; } // running: replaced next time
                catch (IOException) when (i < 20) { System.Threading.Thread.Sleep(250); }
            }
        }

        static void DeleteDirWithRetry(string d)
        {
            for (int i = 0; ; i++)
            {
                try { Directory.Delete(d, true); return; }
                catch (IOException) when (i < 20) { System.Threading.Thread.Sleep(250); }
            }
        }

        static void TryDelete(string f) { try { if (File.Exists(f)) File.Delete(f); } catch { /* best effort */ } }
        static void TryDeleteDir(string d) { try { if (Directory.Exists(d)) Directory.Delete(d, true); } catch { /* best effort */ } }
        static long DirSize(string d) { try { return new DirectoryInfo(d).EnumerateFiles("*", SearchOption.AllDirectories).Sum(f => f.Length); } catch { return 0; } }
    }
}
