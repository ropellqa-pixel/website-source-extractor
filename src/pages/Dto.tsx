import { useState, useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { db } from '@/lib/sdk';
import {
  FileText, Search, Download, Eye, Calendar,
  LayoutGrid, List, ChevronDown, X, Plus, Filter, Pencil, Trash2
} from 'lucide-react';

interface DocCategory {
  id: string;
  name: string;
  color: string;
}

interface DocumentTemplate {
  id: string;
  name: string;
  category_id: string;
  category_name?: string;
  content: string;
  description: string;
  created_at: string;
  usage_count: number;
}

const defaultCategories: DocCategory[] = [
  { id: 'contract', name: 'Договоры', color: 'from-blue-500 to-blue-600' },
  { id: 'order', name: 'Приказы', color: 'from-amber-500 to-amber-600' },
  { id: 'act', name: 'Акты', color: 'from-emerald-500 to-emerald-600' },
  { id: 'invoice', name: 'Счета', color: 'from-purple-500 to-purple-600' },
  { id: 'other', name: 'Другое', color: 'from-slate-500 to-slate-600' },
];

export default function Dto() {
  const { user } = useAuth();
  const [categories, setCategories] = useState<DocCategory[]>(defaultCategories);
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showViewModal, setShowViewModal] = useState<DocumentTemplate | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState<DocumentTemplate | null>(null);
  const [newTemplate, setNewTemplate] = useState({ name: '', category_id: 'contract', content: '', description: '' });
  const [editTemplate, setEditTemplate] = useState({ name: '', category_id: '', content: '', description: '' });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [catsRes, templatesRes] = await Promise.all([
        db.from('dto_categories').select('*').order('name'),
        db.from('dto_templates').select('*').order('created_at', { ascending: false }),
      ]);

      let cats = categories;
      if (!catsRes.error && catsRes.data && catsRes.data.length > 0) {
        setCategories(catsRes.data);
        cats = catsRes.data;
      }

      if (!templatesRes.error && templatesRes.data) {
        const withCategories = templatesRes.data.map((t: any) => {
          const cat = cats.find((c: DocCategory) => c.id === t.category_id);
          return { ...t, category_name: cat?.name || t.category_id };
        });
        setTemplates(withCategories);
      }
    } catch { /* таблицы могут не существовать */ }
    setLoading(false);
  };

  const getCategoryColor = (categoryId: string) => {
    const cat = categories.find(c => c.id === categoryId);
    return cat?.color || 'from-slate-500 to-slate-600';
  };

  const getCategoryName = (categoryId: string) => {
    const cat = categories.find(c => c.id === categoryId);
    return cat?.name || categoryId;
  };

  const filteredTemplates = templates.filter(t => {
    const matchSearch = t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (t.description || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchCat = selectedCategoryId === 'all' || t.category_id === selectedCategoryId;
    return matchSearch && matchCat;
  });

  const categoryStats = categories.reduce((acc, cat) => {
    acc[cat.id] = templates.filter(t => t.category_id === cat.id).length;
    return acc;
  }, {} as Record<string, number>);

  const handleCreateTemplate = async () => {
    if (!newTemplate.name.trim()) return;
    try {
      const { data, error } = await db.from('dto_templates').insert({
        name: newTemplate.name.trim(),
        category_id: newTemplate.category_id,
        content: newTemplate.content,
        description: newTemplate.description,
        usage_count: 0,
      }).select().single();
      if (!error && data) {
        setTemplates(prev => [data, ...prev]);
      }
    } catch { /* таблица не создана */ }
    setNewTemplate({ name: '', category_id: 'contract', content: '', description: '' });
    setShowCreateModal(false);
  };

  const handleEditTemplate = async () => {
    if (!showEditModal || !editTemplate.name.trim()) return;
    try {
      const { error } = await db.from('dto_templates').update({
        name: editTemplate.name.trim(),
        category_id: editTemplate.category_id,
        content: editTemplate.content,
        description: editTemplate.description,
      }).eq('id', showEditModal.id);
      if (!error) {
        setTemplates(prev => prev.map(t => t.id === showEditModal.id ? {
          ...t, name: editTemplate.name.trim(), category_id: editTemplate.category_id,
          content: editTemplate.content, description: editTemplate.description,
        } : t));
      }
    } catch { /* */ }
    setShowEditModal(null);
  };

  const handleDeleteTemplate = async (id: string) => {
    try {
      await db.from('dto_templates').delete().eq('id', id);
      setTemplates(prev => prev.filter(t => t.id !== id));
    } catch { /* */ }
    setShowViewModal(null);
  };

  const handleDownload = (template: DocumentTemplate) => {
    const blob = new Blob([template.content || `Шаблон: ${template.name}`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${template.name}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-full">
      <header className="bg-card backdrop-blur-sm border-b border-border sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-2 py-3 sm:h-16 sm:py-0">
            <div className="flex items-center gap-4">
              <a href="/dashboard" className="text-muted-foreground hover:text-foreground transition-colors">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </a>
              <h1 className="text-xl font-bold text-foreground">Документооборот</h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-blue-500/20 text-blue-600' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'}`}
              >
                <LayoutGrid className="w-5 h-5" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 rounded-lg transition-all ${viewMode === 'list' ? 'bg-blue-500/20 text-blue-600' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'}`}
              >
                <List className="w-5 h-5" />
              </button>
              <button
                onClick={() => setShowCreateModal(true)}
                className="bg-primary text-white px-4 py-2 rounded-lg font-medium hover:bg-primary/85 transition-all flex items-center gap-2 ml-2"
              >
                <Plus className="w-5 h-5" />
                <span className="hidden sm:inline">Новый шаблон</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          <button
            onClick={() => setSelectedCategoryId('all')}
            className={`p-4 rounded-xl transition-all ${
              selectedCategoryId === 'all'
                ? 'bg-blue-500/20 border border-blue-500/30'
                : 'bg-card border border-border hover:border-border'
            }`}
          >
            <div className="w-10 h-10 bg-gradient-to-br from-slate-500 to-slate-600 rounded-lg flex items-center justify-center mb-2">
              <Filter className="w-5 h-5 text-foreground" />
            </div>
            <p className="text-2xl font-bold text-foreground">{templates.length}</p>
            <p className="text-xs text-muted-foreground">Все</p>
          </button>
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategoryId(selectedCategoryId === cat.id ? 'all' : cat.id)}
              className={`p-4 rounded-xl transition-all ${
                selectedCategoryId === cat.id
                  ? 'bg-blue-500/20 border border-blue-500/30'
                  : 'bg-card border border-border hover:border-border'
              }`}
            >
              <div className={`w-10 h-10 bg-gradient-to-br ${cat.color} rounded-lg flex items-center justify-center mb-2`}>
                <FileText className="w-5 h-5 text-foreground" />
              </div>
              <p className="text-2xl font-bold text-foreground">{categoryStats[cat.id] || 0}</p>
              <p className="text-xs text-muted-foreground">{cat.name}</p>
            </button>
          ))}
        </div>

        <div className="flex gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-card border border-border rounded-lg pl-10 pr-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent text-base"
              placeholder="Поиск шаблонов..."
            />
          </div>
          <div className="relative">
            <select
              value={selectedCategoryId}
              onChange={(e) => setSelectedCategoryId(e.target.value)}
              className="bg-card border border-border rounded-lg px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-ring appearance-none pr-10 text-base"
            >
              <option value="all">Все категории</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 bg-card rounded-xl border border-border">
            <p className="text-muted-foreground">Загрузка...</p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredTemplates.length === 0 ? (
              <div className="col-span-full text-center py-12 bg-card rounded-xl border border-border">
                <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">Шаблонов пока нет</p>
                <button onClick={() => setShowCreateModal(true)} className="mt-4 text-blue-600 hover:text-blue-700 font-medium">
                  Создать первый шаблон
                </button>
              </div>
            ) : (
              filteredTemplates.map(template => (
                <div
                  key={template.id}
                  onClick={() => setShowViewModal(template)}
                  className="bg-card rounded-xl p-4 border border-border transition-all cursor-pointer hover:border-border"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className={`w-12 h-12 bg-gradient-to-br ${getCategoryColor(template.category_id)} rounded-xl flex items-center justify-center`}>
                      <FileText className="w-6 h-6 text-foreground" />
                    </div>
                    <span className="text-xs bg-secondary text-foreground/80 px-2 py-1 rounded">
                      {getCategoryName(template.category_id)}
                    </span>
                  </div>
                  <h3 className="font-semibold text-foreground mb-1">{template.name}</h3>
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{template.description || 'Без описания'}</p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {template.created_at?.split('T')[0] || '—'}
                    </span>
                    <span>{template.usage_count || 0} использований</span>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 text-sm font-medium text-muted-foreground">Название</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-muted-foreground">Категория</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-muted-foreground hidden sm:table-cell">Описание</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-muted-foreground hidden md:table-cell">Дата</th>
                  <th className="text-right px-4 py-3 text-sm font-medium text-muted-foreground">Действия</th>
                </tr>
              </thead>
              <tbody>
                {filteredTemplates.map(template => (
                  <tr
                    key={template.id}
                    onClick={() => setShowViewModal(template)}
                    className="border-b border-border cursor-pointer hover:bg-secondary transition-all"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 bg-gradient-to-br ${getCategoryColor(template.category_id)} rounded-lg flex items-center justify-center`}>
                          <FileText className="w-4 h-4 text-foreground" />
                        </div>
                        <span className="font-medium text-foreground">{template.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs bg-secondary text-foreground/80 px-2 py-1 rounded">
                        {getCategoryName(template.category_id)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground hidden sm:table-cell">{template.description}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground hidden md:table-cell">{template.created_at?.split('T')[0]}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); setShowViewModal(template); }}
                          className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-all"
                          title="Просмотреть"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDownload(template); }}
                          className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-all"
                          title="Скачать"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Модалка просмотра шаблона */}
      {showViewModal && (
        <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col border border-border">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{showViewModal.name}</h2>
                <p className="text-sm text-muted-foreground">{getCategoryName(showViewModal.category_id)}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setEditTemplate({ name: showViewModal.name, category_id: showViewModal.category_id, content: showViewModal.content, description: showViewModal.description });
                    setShowEditModal(showViewModal);
                    setShowViewModal(null);
                  }}
                  className="p-2 text-muted-foreground hover:text-blue-600 hover:bg-secondary rounded-lg transition-all"
                  title="Редактировать"
                >
                  <Pencil className="w-5 h-5" />
                </button>
                <button
                  onClick={() => handleDownload(showViewModal)}
                  className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-all"
                  title="Скачать"
                >
                  <Download className="w-5 h-5" />
                </button>
                {(user?.role === 'director' || user?.role === 'deputy_director') && (
                  <button
                    onClick={() => handleDeleteTemplate(showViewModal.id)}
                    className="p-2 text-muted-foreground hover:text-red-600 hover:bg-red-500/10 rounded-lg transition-all"
                    title="Удалить"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
                <button
                  onClick={() => setShowViewModal(null)}
                  className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <div className="bg-white rounded-lg p-8 text-black min-h-[200px]">
                {showViewModal.content ? (
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{showViewModal.content}</pre>
                ) : (
                  <p className="text-muted-foreground italic text-center py-8">Содержимое шаблона пусто</p>
                )}
              </div>
            </div>
            <div className="p-4 border-t border-border text-xs text-muted-foreground flex items-center gap-4">
              <span>{showViewModal.description || 'Без описания'}</span>
              <span>{showViewModal.usage_count || 0} использований</span>
            </div>
          </div>
        </div>
      )}

      {/* Модалка редактирования шаблона */}
      {showEditModal && (
        <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl p-6 w-full max-w-lg border border-border">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-foreground">Редактировать шаблон</h2>
              <button onClick={() => setShowEditModal(null)} className="p-2 text-muted-foreground hover:text-foreground rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-2">Название</label>
                <input
                  type="text"
                  value={editTemplate.name}
                  onChange={(e) => setEditTemplate({ ...editTemplate, name: e.target.value })}
                  className="w-full bg-secondary border border-border rounded-lg px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-2">Категория</label>
                <select
                  value={editTemplate.category_id}
                  onChange={(e) => setEditTemplate({ ...editTemplate, category_id: e.target.value })}
                  className="w-full bg-secondary border border-border rounded-lg px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base"
                >
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-2">Описание</label>
                <input
                  type="text"
                  value={editTemplate.description}
                  onChange={(e) => setEditTemplate({ ...editTemplate, description: e.target.value })}
                  className="w-full bg-secondary border border-border rounded-lg px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-2">Содержимое</label>
                <textarea
                  value={editTemplate.content}
                  onChange={(e) => setEditTemplate({ ...editTemplate, content: e.target.value })}
                  rows={10}
                  className="w-full bg-secondary border border-border rounded-lg px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base resize-none"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={handleEditTemplate}
                disabled={!editTemplate.name.trim()}
                className="flex-1 bg-blue-500 text-white py-2 rounded-lg font-medium hover:bg-blue-600 transition-all disabled:opacity-50"
              >
                Сохранить
              </button>
              <button
                onClick={() => setShowEditModal(null)}
                className="flex-1 bg-secondary text-foreground py-2 rounded-lg font-medium hover:bg-border transition-all"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модалка создания шаблона */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl p-6 w-full max-w-lg border border-border">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-foreground">Новый шаблон</h2>
              <button onClick={() => setShowCreateModal(false)} className="p-2 text-muted-foreground hover:text-foreground rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-2">Название</label>
                <input
                  type="text"
                  value={newTemplate.name}
                  onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                  className="w-full bg-secondary border border-border rounded-lg px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base"
                  placeholder="Договор поставки"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-2">Категория</label>
                <select
                  value={newTemplate.category_id}
                  onChange={(e) => setNewTemplate({ ...newTemplate, category_id: e.target.value })}
                  className="w-full bg-secondary border border-border rounded-lg px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base"
                >
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-2">Описание</label>
                <input
                  type="text"
                  value={newTemplate.description}
                  onChange={(e) => setNewTemplate({ ...newTemplate, description: e.target.value })}
                  className="w-full bg-secondary border border-border rounded-lg px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base"
                  placeholder="Краткое описание шаблона"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-2">Содержимое шаблона</label>
                <textarea
                  value={newTemplate.content}
                  onChange={(e) => setNewTemplate({ ...newTemplate, content: e.target.value })}
                  rows={10}
                  className="w-full bg-secondary border border-border rounded-lg px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base resize-none"
                  placeholder="Текст шаблона документа..."
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={handleCreateTemplate}
                disabled={!newTemplate.name.trim()}
                className="flex-1 bg-blue-500 text-white py-2 rounded-lg font-medium hover:bg-blue-600 transition-all disabled:opacity-50"
              >
                Создать
              </button>
              <button
                onClick={() => setShowCreateModal(false)}
                className="flex-1 bg-secondary text-foreground py-2 rounded-lg font-medium hover:bg-border transition-all"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
