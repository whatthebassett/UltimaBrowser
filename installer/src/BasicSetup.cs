using System;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace UltimaSetup
{
    // Plain setup for the rare PC without WebView2: the same install or uninstall, in an ordinary window.
    sealed class BasicSetup : Form
    {
        public static void Run(Options options, Installer installer, string dir) { using (var f = new BasicSetup(options, installer, dir)) f.ShowDialog(); }

        readonly Label label = new Label { AutoSize = false, Dock = DockStyle.Top, Height = 48, TextAlign = ContentAlignment.MiddleLeft };
        readonly ProgressBar bar = new ProgressBar { Dock = DockStyle.Top, Height = 18, Maximum = 1000 };
        readonly Button go = new Button { Width = 110, Height = 30 };
        bool busy;

        BasicSetup(Options options, Installer installer, string dir)
        {
            var m = installer.Manifest;
            Text = m.ProductName + (options.Uninstall ? " Uninstall" : " Setup");
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(440 * DeviceDpi / 96, 150 * DeviceDpi / 96);
            Padding = new Padding(16);
            var deleteData = new CheckBox { Text = "Also delete my browsing data", Dock = DockStyle.Top, Visible = options.Uninstall };
            label.Text = options.Uninstall ? "Remove " + m.ProductName + " from this PC?" : "Install " + m.ProductName + " " + m.Version + "?";
            go.Text = options.Uninstall ? "Uninstall" : "Install";
            go.Location = new Point(ClientSize.Width - go.Width - 16, ClientSize.Height - go.Height - 12);
            go.Anchor = AnchorStyles.Bottom | AnchorStyles.Right;
            Controls.Add(go); Controls.Add(deleteData); Controls.Add(bar); Controls.Add(label);
            installer.Progress += (f, _) => BeginInvoke(new Action(() => bar.Value = (int)(f * 1000)));
            FormClosing += (s, e) => e.Cancel = busy;
            go.Click += async (s, e) =>
            {
                if (go.Text == "Close") { Close(); return; }
                if (go.Text == "Launch") { installer.Launch(dir); Close(); return; }
                busy = true; go.Enabled = false; deleteData.Enabled = false;
                label.Text = options.Uninstall ? "Removing…" : "Installing…";
                try
                {
                    await Task.Run(() =>
                    {
                        if (options.Uninstall) Installer.Uninstall(m, dir, deleteData.Checked);
                        else { installer.CloseRunning(dir); installer.Install(dir, options.DesktopShortcut); }
                    });
                    label.Text = options.Uninstall ? m.ProductName + " has been removed." : m.ProductName + " is installed.";
                    bar.Value = bar.Maximum;
                    go.Text = options.Uninstall ? "Close" : "Launch";
                }
                catch (Exception ex) { label.Text = "Something went wrong: " + ex.Message; go.Text = "Close"; }
                finally { busy = false; go.Enabled = true; }
            };
        }
    }
}
