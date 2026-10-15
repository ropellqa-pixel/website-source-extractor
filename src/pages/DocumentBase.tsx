import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../lib/auth';
import { db, storage } from '@/lib/sdk';
import {
  Database, Upload, Download, Trash2, Search, FolderOpen, FolderPlus,
  File, FileText, Image, Eye, Calendar, HardDrive,
  ChevronRight, X, Home, FileDown, Loader2, AlertCircle, CheckCircle2
} from 'lucide-react';

interface FolderItem { id: string; name: string; parent_id: string | null; created_at: string; }
interface FileItem { id: string; name: string; type: string; size: number; folder_id: string | null; uploaded_by: string; uploaded_at: string; is_protected: boolean; url?: string; }

export default function DocumentBase() {
  const { user } = useAuth();
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string | null; name: string }[]>([{ id: null, name: 'Корень' }]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showFileModal, setShowFileModal] = useState<FileItem | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadData(); }, [currentFolder]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [foldersRes, filesRes] = await Promise.all([
        db.from('folders').select('*').eq('parent_id', currentFolder).order('name'),
        db.from('base_files').select('*').eq('folder_id', currentFolder).order('uploaded_at', { ascending: false }),
      ]);
      if (!foldersRes.error && foldersRes.data) setFolders(foldersRes.data);
      if (!filesRes.error && filesRes.data) setFiles(filesRes.data);
    } catch { /* */ }
    setLoading(false);
  };

  const navigateToFolder = (folderId: string | null, folderName?: string) => {
    if (folderId === null) {
      setCurrentFolder(null);
      setBreadcrumbs([{ id: null, name: 'Корень' }]);
    } else {
      setCurrentFolder(folderId);
      setBreadcrumbs(prev => [...prev, { id: folderId, name: folderName || 'Папка' }]);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      const { data, error } = await db.from('folders').insert({
        name: newFolderName.trim(),
        parent_id: currentFolder,
      }).select().single();
      if (!error && data) setFolders(prev => [...prev, data]);
    } catch { /* */ }
    setNewFolderName('');
    setShowNewFolderModal(false);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    setUploading(true);
    setUploadError('');
    const newFiles: FileItem[] = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      try {
        let fileUrl: string | null = null;

        // Загружаем файл в storage
        try {
          const result = await storage.upload('documents', file);
          if (result && result.url) {
            fileUrl = result.url;
          }
        } catch (storageErr) {
          console.warn('Storage upload failed, saving metadata only:', storageErr);
        }

        // Записываем метаданные в базу
        const { data, error } = await db.from('base_files').insert({
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: file.size,
          folder_id: currentFolder,
          uploaded_by: user?.fullName || user?.email || 'Пользователь',
          is_protected: false,
          url: fileUrl,
        }).select().single();

        if (!error && data) {
          newFiles.push(data as FileItem);
        } else if (error) {
          console.error('DB insert error:', error);
          setUploadError(`Ошибка сохранения «${file.name}»: ${error.message || 'неизвестная ошибка'}`);
        }
      } catch (err) {
        console.error('Upload error for file:', file.name, err);
        setUploadError(`Ошибка загрузки «${file.name}»`);
      }
    }

    if (newFiles.length > 0) {
      setFiles(prev => [...newFiles, ...prev]);
    }

    setUploading(false);
    setShowUploadModal(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDeleteFile = async (id: string) => {
    if (user?.role !== 'director' && user?.role !== 'deputy_director') return;
    try { await db.from('base_files').delete().eq('id', id); } catch { /* */ }
    setFiles(prev => prev.filter(f => f.id !== id));
    setShowFileModal(null);
  };

  const handleDeleteFolder = async (id: string) => {
    if (user?.role !== 'director' && user?.role !== 'deputy_director') return;
    try { await db.from('folders').delete().eq('id', id); } catch { /* */ }
    setFolders(prev => prev.filter(f => f.id !== id));
  };

  const handleDownload = (file: FileItem) => {
    if (file.url) {
      const a = document.createElement('a');
      a.href = file.url;
      a.download = file.name;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      // Файл без URL — показываем информацию
      const blob = new Blob(
        [`Файл: ${file.name}\nРазмер: ${formatSize(file.size)}\n\nФайл был загружен без привязки к хранилищу. Доступен только просмотр метаданных.`],
        { type: 'text/plain' }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name + '.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return '0 Б';
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} КБ`;
    return `${(bytes / 1048576).toFixed(2)} МБ`;
  };

  const getFileIcon = (type: string) => {
    if (type?.includes('image')) return Image;
    if (type?.includes('pdf')) return FileText;
    return File;
  };

  const canDelete = user?.role === 'director' || user?.role === 'deputy_director';
  const totalSize = files.reduce((acc, f) => acc + (Number(f.size) || 0), 0);
  const filteredFolders = folders.filter(f => f.name.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredFiles = files.filter(f => f.name.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="min-h-full">
      {/* Header */}
      <header className="bg-card backdrop-blur-sm border-b border-border sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-2 py-3 sm:h-16 sm:py-0">
            <div className="flex items-center gap-4">
              <a href="/dashboard" className="text-muted-foreground hover:text-foreground transition-colors">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </a>
              <h1 className="text-xl font-bold text-foreground">База документов</h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowNewFolderModal(true)}
                className="bg-secondary text-foreground px-4 py-2 rounded-lg font-medium hover:bg-border transition-all flex items-center gap-2"
              >
                <FolderPlus className="w-5 h-5" />
                <span className="hidden sm:inline">Новая папка</span>
              </button>
              <button
                onClick={() => setShowUploadModal(true)}
                disabled={uploading}
                className="bg-gradient-to-r from-emerald-500 to-emerald-600 text-white px-4 py-2 rounded-lg font-medium hover:from-emerald-600 hover:to-emerald-700 transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                <span className="hidden sm:inline">{uploading ? 'Загрузка...' : 'Загрузить'}</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-6">
          <div className="bg-card rounded-xl p-4 border border-border">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl flex items-center justify-center">
                <Database className="w-6 h-6 text-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{files.length}</p>
                <p className="text-sm text-muted-foreground">Файлов</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl p-4 border border-border">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center">
                <HardDrive className="w-6 h-6 text-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{formatSize(totalSize)}</p>
                <p className="text-sm text-muted-foreground">Объём</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl p-4 border border-border">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-amber-500 to-amber-600 rounded-xl flex items-center justify-center">
                <FolderOpen className="w-6 h-6 text-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{folders.length}</p>
                <p className="text-sm text-muted-foreground">Папок</p>
              </div>
            </div>
          </div>
        </div>

        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 mb-4 text-sm">
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
              <button
                onClick={() => {
                  setCurrentFolder(crumb.id);
                  setBreadcrumbs(breadcrumbs.slice(0, i + 1));
                }}
                className={`hover:text-foreground transition-colors ${i === breadcrumbs.length - 1 ? 'text-foreground font-medium' : 'text-muted-foreground'}`}
              >
                {i === 0 && <Home className="w-4 h-4 inline mr-1" />}
                {crumb.name}
              </button>
            </span>
          ))}
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-card border border-border rounded-lg pl-10 pr-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base"
              placeholder="Поиск файлов и папок..."
            />
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="text-center py-12 bg-card rounded-xl border border-border">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-3" />
            <p className="text-muted-foreground">Загрузка...</p>
          </div>
        ) : (
          <>
            {/* Folders */}
            {filteredFolders.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-muted-foreground mb-3">Папки</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {filteredFolders.map((folder) => (
                    <div
                      key={folder.id}
                      className="bg-card rounded-xl p-4 border border-border hover:border-border transition-all cursor-pointer group relative"
                      onClick={() => navigateToFolder(folder.id, folder.name)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="w-12 h-12 bg-gradient-to-br from-blue-500/20 to-indigo-500/20 rounded-xl flex items-center justify-center mb-3">
                          <FolderOpen className="w-6 h-6 text-blue-600" />
                        </div>
                        {canDelete && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteFolder(folder.id); }}
                            className="p-1.5 text-muted-foreground hover:text-red-600 hover:bg-red-500/10 rounded-lg transition-all lg:opacity-0 lg:group-hover:opacity-100"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      <h3 className="font-medium text-foreground truncate">{folder.name}</h3>
                      <p className="text-xs text-muted-foreground mt-1">{folder.created_at?.split('T')[0]}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Files */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Файлы</h3>
              {filteredFiles.length === 0 && filteredFolders.length === 0 ? (
                <div className="text-center py-12 bg-card rounded-xl border border-border">
                  <FolderOpen className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">Папка пуста</p>
                  <button
                    onClick={() => setShowUploadModal(true)}
                    className="mt-4 text-emerald-600 hover:text-emerald-700 font-medium"
                  >
                    Загрузить файл
                  </button>
                </div>
              ) : (
                <div className="bg-card rounded-xl border border-border overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left px-4 py-3 text-sm font-medium text-muted-foreground">Имя</th>
                        <th className="text-left px-4 py-3 text-sm font-medium text-muted-foreground hidden sm:table-cell">Размер</th>
                        <th className="text-left px-4 py-3 text-sm font-medium text-muted-foreground hidden md:table-cell">Загрузил</th>
                        <th className="text-left px-4 py-3 text-sm font-medium text-muted-foreground hidden lg:table-cell">Дата</th>
                        <th className="text-right px-4 py-3 text-sm font-medium text-muted-foreground">Действия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredFiles.map((file) => {
                        const FileIcon = getFileIcon(file.type);
                        return (
                          <tr key={file.id} className="border-b border-border hover:bg-secondary transition-all">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <FileIcon className="w-5 h-5 text-muted-foreground shrink-0" />
                                <div>
                                  <span className="font-medium text-foreground text-sm">{file.name}</span>
                                  {file.is_protected && <span className="text-xs text-amber-600 ml-2">🔒</span>}
                                  {file.url && (
                                    <span className="text-xs text-emerald-600 ml-2 flex items-center gap-1 inline-flex">
                                      <CheckCircle2 className="w-3 h-3" />сохранён
                                    </span>
                                  )}
                                  {!file.url && (
                                    <span className="text-xs text-muted-foreground ml-2">только мета</span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm text-muted-foreground hidden sm:table-cell">{formatSize(Number(file.size))}</td>
                            <td className="px-4 py-3 text-sm text-muted-foreground hidden md:table-cell">{file.uploaded_by}</td>
                            <td className="px-4 py-3 text-sm text-muted-foreground hidden lg:table-cell">{file.uploaded_at?.split('T')[0]}</td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  onClick={() => setShowFileModal(file)}
                                  className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-all"
                                  title="Просмотреть"
                                >
                                  <Eye className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleDownload(file)}
                                  className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-all"
                                  title="Скачать"
                                >
                                  <FileDown className="w-4 h-4" />
                                </button>
                                {canDelete && (
                                  <button
                                    onClick={() => handleDeleteFile(file.id)}
                                    className="p-2 text-muted-foreground hover:text-red-600 hover:bg-red-500/10 rounded-lg transition-all"
                                    title="Удалить"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl p-6 w-full max-w-md border border-border">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-foreground">Загрузить файл</h2>
              <button onClick={() => { setShowUploadModal(false); setUploadError(''); }} className="p-2 text-muted-foreground hover:text-foreground rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            {uploadError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <p className="text-red-700 text-sm">{uploadError}</p>
              </div>
            )}

            <div
              className="border-2 border-dashed border-border rounded-xl p-8 text-center hover:border-emerald-500 transition-all cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="w-12 h-12 text-emerald-500 animate-spin mx-auto mb-3" />
              ) : (
                <Upload className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              )}
              <p className="text-muted-foreground mb-1">{uploading ? 'Загрузка файлов...' : 'Нажмите или перетащите файл'}</p>
              <p className="text-muted-foreground text-xs">Любые форматы, до нескольких МБ</p>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleUpload}
                disabled={uploading}
                multiple
              />
            </div>

            <button
              onClick={() => { setShowUploadModal(false); setUploadError(''); }}
              className="w-full mt-4 bg-secondary text-foreground py-2 rounded-lg font-medium hover:bg-border transition-all"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* New Folder Modal */}
      {showNewFolderModal && (
        <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl p-6 w-full max-w-md border border-border">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-foreground">Новая папка</h2>
              <button onClick={() => setShowNewFolderModal(false)} className="p-2 text-muted-foreground hover:text-foreground rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base mb-4"
              placeholder="Название папки"
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim()}
                className="flex-1 bg-blue-500 text-white py-2 rounded-lg font-medium hover:bg-blue-600 transition-all disabled:opacity-50"
              >
                Создать
              </button>
              <button
                onClick={() => { setShowNewFolderModal(false); setNewFolderName(''); }}
                className="flex-1 bg-secondary text-foreground py-2 rounded-lg font-medium hover:bg-border transition-all"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File Preview Modal */}
      {showFileModal && (
        <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col border border-border">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground truncate">{showFileModal.name}</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDownload(showFileModal)}
                  className="flex items-center gap-2 bg-emerald-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-emerald-600 transition-all"
                >
                  <Download className="w-4 h-4" />
                  Скачать
                </button>
                {canDelete && (
                  <button
                    onClick={() => handleDeleteFile(showFileModal.id)}
                    className="p-2 text-muted-foreground hover:text-red-600 hover:bg-red-500/10 rounded-lg transition-all"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
                <button
                  onClick={() => setShowFileModal(null)}
                  className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {showFileModal.url ? (
                <div className="text-center">
                  {showFileModal.type?.includes('image') ? (
                    <img src={showFileModal.url} alt={showFileModal.name} className="max-w-full max-h-96 mx-auto rounded-lg" />
                  ) : showFileModal.type?.includes('pdf') ? (
                    <iframe
                      src={showFileModal.url}
                      className="w-full h-96 rounded-lg"
                      title={showFileModal.name}
                    />
                  ) : (
                    <div className="bg-secondary rounded-xl p-8 text-center">
                      <FileText className="w-16 h-16 text-muted-foreground mx-auto mb-3" />
                      <p className="text-foreground font-medium mb-4">{showFileModal.name}</p>
                      <a
                        href={showFileModal.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block bg-emerald-500 text-white px-6 py-3 rounded-lg font-medium hover:bg-emerald-600 transition-all"
                      >
                        <Download className="w-4 h-4 inline mr-2" />
                        Открыть / Скачать
                      </a>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-secondary rounded-xl p-8 text-center">
                  <FileText className="w-16 h-16 text-muted-foreground mx-auto mb-3" />
                  <p className="text-foreground font-medium">{showFileModal.name}</p>
                  <p className="text-muted-foreground text-sm mt-1">{formatSize(Number(showFileModal.size))}</p>
                  <p className="text-muted-foreground text-xs mt-3">Файл загружен без привязки к хранилищу</p>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-border text-xs text-muted-foreground">
              <span>Загрузил: {showFileModal.uploaded_by}</span> · <span>{showFileModal.uploaded_at?.split('T')[0]}</span>
              {showFileModal.url && <span className="ml-2 text-emerald-600">✓ доступен для скачивания</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
