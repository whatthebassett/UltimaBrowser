using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

namespace UltimaSetup
{
    // Start menu and desktop shortcuts, carrying Ultima's AppUserModelID so Windows groups its windows, taskbar pins
    // and notifications under the shortcut (what electron-builder's installer does too).
    static class ShellLink
    {
        public static void Create(string lnkPath, string target, string workingDir, string description, string appUserModelId)
        {
            var link = (IShellLinkW)new CShellLink();
            link.SetPath(target);
            link.SetWorkingDirectory(workingDir);
            link.SetDescription(description);
            link.SetIconLocation(target, 0);
            if (!string.IsNullOrEmpty(appUserModelId))
            {
                var store = (IPropertyStore)link;
                var key = new PropertyKey { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 }; // PKEY_AppUserModel_ID
                var value = new PropVariant { vt = 31 /* VT_LPWSTR */, p1 = Marshal.StringToCoTaskMemUni(appUserModelId) };
                try { store.SetValue(ref key, ref value); store.Commit(); }
                finally { PropVariantClear(ref value); }
            }
            ((IPersistFile)link).Save(lnkPath, true);
            Marshal.FinalReleaseComObject(link);
        }

        [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant pvar);

        [ComImport, Guid("00021401-0000-0000-C000-000000000046")] class CShellLink { }

        [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
        interface IShellLinkW
        {
            void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszFile, int cch, IntPtr pfd, uint fFlags);
            void GetIDList(out IntPtr ppidl);
            void SetIDList(IntPtr pidl);
            void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszName, int cch);
            void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
            void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszDir, int cch);
            void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
            void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszArgs, int cch);
            void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
            void GetHotkey(out short pwHotkey);
            void SetHotkey(short wHotkey);
            void GetShowCmd(out int piShowCmd);
            void SetShowCmd(int iShowCmd);
            void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszIconPath, int cch, out int piIcon);
            void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
            void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, uint dwReserved);
            void Resolve(IntPtr hwnd, uint fFlags);
            void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
        }

        [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
        interface IPropertyStore
        {
            void GetCount(out uint cProps);
            void GetAt(uint iProp, out PropertyKey pkey);
            void GetValue(ref PropertyKey key, out PropVariant pv);
            void SetValue(ref PropertyKey key, ref PropVariant pv);
            void Commit();
        }

        [StructLayout(LayoutKind.Sequential, Pack = 4)]
        struct PropertyKey { public Guid fmtid; public uint pid; }

        // PROPVARIANT: 24 bytes on x64 (vt, three reserved words, a 16-byte union)
        [StructLayout(LayoutKind.Sequential)]
        struct PropVariant { public ushort vt; public ushort r1, r2, r3; public IntPtr p1; public IntPtr p2; }
    }
}
