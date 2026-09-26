import { useState, useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { db } from '@/lib/sdk';
import {
  FileText, Plus, Search, Edit3, Trash2, Eye, Download,
  Calendar, User, Tag, MoreVertical, X, Save, FolderOpen
} from 'lucide-react';

interface Document {
  id: string;
  title: string;
  content: string;
  author: string;
  created_at: string;
  updated_at: string;
  tags: string[];
}

export default function Documents() {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [showMenu, setShowMenu] = useState<string | null>(null);
  const [showViewModal, setShowViewModal] = useState<Document | null>(null);
  const [tagInput, setTagInput] = useState('');

  useEffect(() => {
    loadDocuments();
  }, []);

  const loadDocuments = async () => {
    try {
      const { data, error } = await db
        .from('documents')
        .select('*')
        .order('created_at', { ascending: false });
      if (!error && data) {
        setDocuments(data.map((d: any) => ({
          ...d,
          tags: Array.isArray(d.tags) ? d.tags : [],
        })));
      }
    } catch {
      // Таблица может не существовать
    } finally {
      setLoading(false);
    }
  };

  const filteredDocs = documents.filter(doc =>
    doc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (doc.tags || []).some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const handleCreate = () => {
    const newDoc: Document = {
      id: 'new_' + Date.now(),
      title: 'Новый документ',
      content: '',
      author: user?.fullName || 'Пользователь',
      created_at: new Date().toISOString().split('T')[0],
      updated_at: new Date().toISOString().split('T')[0],
      tags: [],
    };
    setDocuments([newDoc, ...documents]);
    setSelectedDoc(newDoc);
    setEditContent('');
    setEditTitle('Новый документ');
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!selectedDoc) return;
    const now = new Date().toISOString();
    if (selectedDoc.id.startsWith('new_')) {
      // Вставка в базу
      try {
        const { data, error } = await db.from('documents').insert({
          title: editTitle,
          content: editContent,
          author: user?.fullName || 'Пользователь',
          tags: tagInput ? tagInput.split(',').map(t => t.trim()) : [],
        }).select().single();
        if (!error && data) {
          setDocuments(prev => prev.map(d => d.id === selectedDoc.id ? {
            ...data, tags: Array.isArray(data.tags) ? data.tags : [],
          } : d));
          setSelectedDoc({ ...data, tags: Array.isArray(data.tags) ? data.tags : [] });
        }
      } catch { /* таблица не создана */ }
    } else {
      // Обновление
      try {
        const { error } = await db.from('documents').update({
          title: editTitle,
          content: editContent,
          updated_at: now,
          tags: tagInput ? tagInput.split(',').map(t => t.trim()) : [],
        }).eq('id', selectedDoc.id);
        if (!error) {
          setDocuments(prev => prev.map(d => d.id === selectedDoc.id ? {
            ...d, title: editTitle, content: editContent, updated_at: now.split('T')[0],
            tags: tagInput ? tagInput.split(',').map(t => t.trim()) : d.tags,
          } : d));
        }
      } catch { /* игнорируем */ }
    }
    setIsEditing(false);
  };

  const handleDelete = async (id: string) => {
    if (user?.role !== 'director' && user?.role !== 'deputy_director') return;
    try {
      await db.from('documents').delete().eq('id', id);
    } catch { /* игнорируем */ }
    setDocuments(documents.filter(d => d.id !== id));
    if (selectedDoc?.id === id) setSelectedDoc(null);
    setShowMenu(null);
  };

  const handleDownload = (doc: Document) => {
    const blob = new Blob([doc.content || 'Пустой документ'], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.title}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-full">
      <header className="bg-card backdrop-blur-sm border-b border-border sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <a href="/dashboard" className="text-muted-foreground hover:text-foreground transition-colors">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </a>
              <h1 className="text-xl font-bold text-foreground">Документы</h1>
            </div>
            <button
              onClick={handleCreate}
              className="bg-primary text-white px-4 py-2 rounded-lg font-medium hover:bg-primary/85 transition-all flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Новый документ
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-card border border-border rounded-lg pl-10 pr-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent text-base"
              placeholder="Поиск документов..."
            />
          </div>
        </div>

        <div className="flex gap-6">
          <div className="flex-1">
            {loading ? (
              <div className="text-center py-12 bg-card rounded-xl border border-border">
                <p className="text-muted-foreground">Загрузка...</p>
              </div>
            ) : filteredDocs.length === 0 ? (
              <div className="text-center py-12 bg-card rounded-xl border border-border">
                <FolderOpen className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">Документов пока нет</p>
                <button onClick={handleCreate} className="mt-4 text-blue-600 hover:text-blue-700 font-medium">
                  Создать первый документ
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredDocs.map((doc) => (
                  <div
                    key={doc.id}
                    onClick={() => { setSelectedDoc(doc); setIsEditing(false); setShowViewModal(doc); }}
                    className={`p-4 rounded-xl cursor-pointer transition-all ${
                      selectedDoc?.id === doc.id
                        ? 'bg-blue-500/10 border border-blue-500/30'
                        : 'bg-card border border-border hover:border-border'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-semibold text-foreground mb-1">{doc.title}</h3>
                        <p className="text-sm text-muted-foreground line-clamp-2">{doc.content || 'Без содержимого'}</p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{doc.updated_at}</span>
                          <span className="flex items-center gap-1"><User className="w-3 h-3" />{doc.author}</span>
                        </div>
                        {doc.tags.length > 0 && (
                          <div className="flex gap-2 mt-2">
                            {doc.tags.map(tag => (
                              <span key={tag} className="text-xs bg-secondary text-foreground/80 px-2 py-1 rounded">
                                <Tag className="w-3 h-3 inline mr-1" />{tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="relative">
                        <button
                          onClick={(e) => { e.stopPropagation(); setShowMenu(showMenu === doc.id ? null : doc.id); }}
                          className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-all"
                        >
                          <MoreVertical className="w-5 h-5" />
                        </button>
                        {showMenu === doc.id && (
                          <div className="absolute right-0 top-full mt-1 w-48 bg-card border border-border rounded-lg shadow-xl z-10">
                            <button
                              onClick={(e) => { e.stopPropagation(); setShowViewModal(doc); setShowMenu(null); }}
                              className="w-full px-4 py-2 text-left text-sm text-foreground hover:bg-secondary flex items-center gap-2"
                            >
                              <Eye className="w-4 h-4" />Просмотреть
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDownload(doc); setShowMenu(null); }}
                              className="w-full px-4 py-2 text-left text-sm text-foreground hover:bg-secondary flex items-center gap-2"
                            >
                              <Download className="w-4 h-4" />Скачать
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setSelectedDoc(doc); setIsEditing(true); setEditTitle(doc.title); setEditContent(doc.content); setTagInput((doc.tags || []).join(', ')); setShowMenu(null); }}
                              className="w-full px-4 py-2 text-left text-sm text-foreground hover:bg-secondary flex items-center gap-2"
                            >
                              <Edit3 className="w-4 h-4" />Редактировать
                            </button>
                            {(user?.role === 'director' || user?.role === 'deputy_director') && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDelete(doc.id); }}
                                className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-500/10 flex items-center gap-2"
                              >
                                <Trash2 className="w-4 h-4" />Удалить
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {selectedDoc && isEditing && (
            <div className="w-96 bg-card rounded-xl border border-border p-6">
              <h2 className="text-lg font-semibold text-foreground mb-4">Редактирование</h2>
              <div className="mb-4">
                <label className="block text-sm font-medium text-foreground/80 mb-2">Название</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-lg px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-foreground/80 mb-2">Теги (через запятую)</label>
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-lg px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base"
                  placeholder="договор, поставка"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-foreground/80 mb-2">Содержимое</label>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={14}
                  className="w-full bg-secondary border border-border rounded-lg px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base resize-none"
                  placeholder="Введите текст документа..."
                />
              </div>
              <div className="flex gap-2">
                <button onClick={handleSave} className="flex-1 bg-blue-500 text-white py-2 rounded-lg font-medium hover:bg-blue-600 transition-all flex items-center justify-center gap-2">
                  <Save className="w-4 h-4" />Сохранить
                </button>
                <button onClick={() => setIsEditing(false)} className="flex-1 bg-secondary text-foreground py-2 rounded-lg font-medium hover:bg-border transition-all">
                  Отмена
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Модальное окно просмотра документа */}
      {showViewModal && (
        <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col border border-border">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground truncate">{showViewModal.title}</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDownload(showViewModal)}
                  className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-all"
                  title="Скачать"
                >
                  <Download className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setShowViewModal(null)}
                  className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <div className="prose prose-invert max-w-none">
                <p className="text-foreground/80 whitespace-pre-wrap leading-relaxed">
                  {showViewModal.content || 'Документ пуст.'}
                </p>
              </div>
            </div>
            <div className="p-4 border-t border-border text-xs text-muted-foreground flex items-center gap-4">
              <span>Создан: {showViewModal.created_at}</span>
              <span>Обновлён: {showViewModal.updated_at}</span>
              <span>Автор: {showViewModal.author}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
