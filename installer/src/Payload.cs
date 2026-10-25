using System;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

namespace UltimaSetup
{
    // What build.js writes into the installer next to the packed app.
    public class Manifest
    {
        public string ProductName { get; set; } = "Ultima Browser";
        public string Version { get; set; } = "0.0.0";
        public string ExeName { get; set; } = "Ultima Browser.exe";
        public string AppId { get; set; } = "com.ultimabass.ultimabrowser";
        public string Publisher { get; set; } = "UltimaBass";
        public string RegistryKey { get; set; } = "UltimaBrowser";
        public long UnpackedBytes { get; set; }
    }

    // The packed app travels at the end of the installer exe (build.js appends it):
    //   [setup exe][app .zip][manifest JSON][u64 manifest length][u64 zip length]["ULTIMAP1"]
    // The uninstaller is the same exe with an empty zip, so it still knows the manifest.
    public sealed class Payload
    {
        const string Magic = "ULTIMAP1";
        const int TrailerSize = 8 + 8 + 8;

        public string Path { get; private set; }
        public long ExeLength { get; private set; }
        public long ZipOffset { get; private set; }
        public long ZipLength { get; private set; }
        public Manifest Manifest { get; private set; }
        public bool HasApp => ZipLength > 0;

        public static Payload Open(string path)
        {
            using (var f = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (var r = new BinaryReader(f))
            {
                if (f.Length < TrailerSize) return null;
                f.Seek(-TrailerSize, SeekOrigin.End);
                long manifestLength = r.ReadInt64();
                long zipLength = r.ReadInt64();
                if (Encoding.ASCII.GetString(r.ReadBytes(8)) != Magic) return null;
                long manifestOffset = f.Length - TrailerSize - manifestLength;
                long zipOffset = manifestOffset - zipLength;
                if (manifestLength <= 0 || zipLength < 0 || zipOffset <= 0) return null;
                f.Seek(manifestOffset, SeekOrigin.Begin);
                var json = Encoding.UTF8.GetString(r.ReadBytes((int)manifestLength));
                return new Payload
                {
                    Path = path,
                    ExeLength = zipOffset,
                    ZipOffset = zipOffset,
                    ZipLength = zipLength,
                    Manifest = new JavaScriptSerializer().Deserialize<Manifest>(json),
                };
            }
        }

        public Stream OpenZip()
        {
            var f = new FileStream(Path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            return new SubStream(f, ZipOffset, ZipLength);
        }

        // The uninstaller: this exe and its manifest, without the app.
        public void WriteUninstaller(string target)
        {
            var manifest = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(Manifest));
            using (var src = new FileStream(Path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (var dst = new FileStream(target, FileMode.Create, FileAccess.Write))
            using (var w = new BinaryWriter(dst))
            {
                var buffer = new byte[1 << 20];
                long left = ExeLength;
                while (left > 0)
                {
                    int n = src.Read(buffer, 0, (int)Math.Min(buffer.Length, left));
                    if (n <= 0) throw new EndOfStreamException("The installer file is incomplete.");
                    dst.Write(buffer, 0, n);
                    left -= n;
                }
                w.Write(manifest);
                w.Write((long)manifest.Length);
                w.Write(0L);
                w.Write(Encoding.ASCII.GetBytes(Magic));
            }
        }
    }

    // A read-only, seekable window onto part of a file (the zip inside the exe), for ZipArchive.
    sealed class SubStream : Stream
    {
        readonly Stream inner;
        readonly long start, length;
        long position;

        public SubStream(Stream inner, long start, long length) { this.inner = inner; this.start = start; this.length = length; }
        public override bool CanRead => true;
        public override bool CanSeek => true;
        public override bool CanWrite => false;
        public override long Length => length;
        public override long Position { get => position; set => position = Math.Max(0, Math.Min(length, value)); }

        public override int Read(byte[] buffer, int offset, int count)
        {
            count = (int)Math.Min(count, length - position);
            if (count <= 0) return 0;
            inner.Seek(start + position, SeekOrigin.Begin);
            int n = inner.Read(buffer, offset, count);
            position += n;
            return n;
        }

        public override long Seek(long offset, SeekOrigin origin)
        {
            Position = origin == SeekOrigin.Begin ? offset : origin == SeekOrigin.Current ? position + offset : length + offset;
            return position;
        }

        public override void Flush() { }
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        protected override void Dispose(bool disposing) { if (disposing) inner.Dispose(); base.Dispose(disposing); }
    }
}
