using System;
using System.IO;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Threading;
using System.Threading.Tasks;
using AbizShell;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace AbizRecorder
{
    /// <summary>
    /// Фоновая служба Windows: видеорегистратор склада и мост к контроллеру СКУД Gate (дверь склада).
    /// Запускается вместе с Windows (до входа сотрудника), скрыта, пароль не нужен.
    /// Доступ у неё только к записи камер склада — отдельный ключ, выданный программой АБИЗ
    /// (C:\ProgramData\AnodBiz\recorder\key). Управлять ПК или сайтом этим ключом нельзя.
    /// </summary>
    public static class Program
    {
        public static void Main(string[] args)
        {
            Host.CreateDefaultBuilder(args)
                .UseWindowsService(o => o.ServiceName = "AbizRecorder")
                .ConfigureServices(s => s.AddHostedService<RecorderWorker>())
                .Build()
                .Run();
        }
    }

    public sealed class RecorderWorker : BackgroundService
    {
        public static string Dir => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "AnodBiz", "recorder");

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            SkudRecorder.StatusPrefix = "служба · ";
            PrepareDir();
            string? current = null;
            while (!stoppingToken.IsCancellationRequested)
            {
                string? key = ReadKey();
                if (!string.IsNullOrEmpty(key) && key != current)
                {
                    current = key;
                    SkudRecorder.EnsureStarted(key);
                    GateBridge.EnsureStarted(key);
                }
                try { await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken); }
                catch (OperationCanceledException) { break; }
            }
            SkudRecorder.StopAll();
            GateBridge.StopAll();
        }

        private static string? ReadKey()
        {
            try
            {
                string f = Path.Combine(Dir, "key");
                if (!File.Exists(f)) return null;
                string k = File.ReadAllText(f).Trim();
                return k.StartsWith("rec_") ? k : null;
            }
            catch { return null; }
        }

        /// <summary>Папка для ключа: программа АБИЗ (обычные права) должна уметь записать туда ключ.</summary>
        private static void PrepareDir()
        {
            try
            {
                var di = Directory.CreateDirectory(Dir);
                var acl = di.GetAccessControl();
                acl.AddAccessRule(new FileSystemAccessRule(
                    new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null),
                    FileSystemRights.Modify,
                    InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                    PropagationFlags.None, AccessControlType.Allow));
                di.SetAccessControl(acl);
            }
            catch { }
        }
    }
}
