using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
// UniformGrid — в System.Windows.Controls.Primitives

namespace AbizShell
{
    /// <summary>
    /// Раздел «Камеры» в АБИЗ: сетка живых камер на встроенном VLC. Клик по камере —
    /// на весь экран (там звук включается). В киоске окно на весь экран без рамки.
    /// </summary>
    public partial class CamerasWindow : Window
    {
        private readonly string _apiToken;
        private readonly List<CameraTile> _tiles = new();

        public CamerasWindow(string apiToken)
        {
            InitializeComponent();
            _apiToken = apiToken ?? "";

            if (Edition.Kiosk)
            {
                WindowStyle = WindowStyle.None;
                ResizeMode = ResizeMode.NoResize;
                WindowState = WindowState.Maximized;
                ShowInTaskbar = false;
                StateChanged += (s, e) => { if (WindowState == WindowState.Minimized) WindowState = WindowState.Maximized; };
            }
            else
            {
                Width = 1200;
                Height = 820;
                Title = Edition.Name + " — Камеры";
            }

            Loaded += async (s, e) => await LoadAsync();
            Closing += (s, e) => StopAll();
            KeyDown += (s, e) => { if (e.Key == Key.Escape) Close(); };
        }

        private async System.Threading.Tasks.Task LoadAsync()
        {
            StatusLabel.Visibility = Visibility.Visible;
            StatusLabel.Text = "Загрузка камер...";
            var (cameras, error) = await CamerasClient.ListAsync(_apiToken);
            if (error != null || cameras.Count == 0)
            {
                StatusLabel.Text = error ?? "Камеры не найдены";
                return;
            }
            StatusLabel.Visibility = Visibility.Collapsed;

            // Колонки под количество камер: 1 камера — 1, до 4 — 2, иначе 3.
            int columns = cameras.Count <= 1 ? 1 : cameras.Count <= 4 ? 2 : 3;
            TilesHost.Items.Clear();
            StopAll();
            _tiles.Clear();

            foreach (var cam in cameras.OrderBy(c => c.OrderIndex))
            {
                var tile = new CameraTile(_apiToken, cam) { Height = 240 };
                tile.Enlarge += OpenFull;
                _tiles.Add(tile);
                TilesHost.Items.Add(tile);
            }
            ApplyColumns(columns);
        }

        private void ApplyColumns(int columns)
        {
            // Доберёмся до UniformGrid внутри ItemsControl и зададим число колонок.
            Dispatcher.BeginInvoke(new Action(() =>
            {
                var panel = FindUniformGrid(TilesHost);
                if (panel != null) panel.Columns = columns;
            }), System.Windows.Threading.DispatcherPriority.Loaded);
        }

        private static UniformGrid? FindUniformGrid(DependencyObject root)
        {
            int count = System.Windows.Media.VisualTreeHelper.GetChildrenCount(root);
            for (int i = 0; i < count; i++)
            {
                var child = System.Windows.Media.VisualTreeHelper.GetChild(root, i);
                if (child is UniformGrid ug) return ug;
                var found = FindUniformGrid(child);
                if (found != null) return found;
            }
            return null;
        }

        private void OpenFull(CamerasClient.CameraInfo cam)
        {
            var win = new CameraFullWindow(_apiToken, cam) { Owner = this };
            win.ShowDialog();
        }

        private void StopAll()
        {
            foreach (var t in _tiles) t.Stop();
        }

        private async void Refresh_Click(object sender, RoutedEventArgs e) => await LoadAsync();

        private void Close_Click(object sender, RoutedEventArgs e) => Close();
    }
}