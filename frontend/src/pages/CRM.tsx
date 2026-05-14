import { useEffect, useMemo, useState } from 'react';
import { Users, Mail, Phone, Search, UserPlus, Edit2, Briefcase, User, RefreshCw } from 'lucide-react';
import { customersApi } from '../lib/api';
import type { Customer } from '../lib/database.types';
import { useLanguage } from '../i18n';
import { useRealtimeTable } from '../lib/useRealtimeTable';
import CustomerModal, { type CustomerFormData } from '../components/CustomerModal';

const TIER_STYLES: Record<string, string> = {
  vip:     'bg-purple-500/20 text-purple-400 border-purple-500/30',
  gold:    'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  silver:  'bg-slate-400/20 text-slate-300 border-slate-400/30',
  general: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

export default function CRM() {
  const { t } = useLanguage();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);

  async function load() {
    setLoading(true); setErr(null);
    try {
      setCustomers(await customersApi.list());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  useRealtimeTable('customers', () => void load());

  async function handleSave(data: CustomerFormData) {
    const payload = {
      code: data.code || null,
      name: data.name,
      customer_type: data.customer_type,
      tier: data.tier,
      email: data.email || null,
      phone: data.phone || null,
      tax_id: data.tax_id || null,
      notes: data.notes || null,
    };
    if (editing) {
      await customersApi.update(editing.id, payload);
    } else {
      await customersApi.create(payload);
    }
    await load();
  }

  const filtered = useMemo(() => {
    if (!search) return customers;
    const s = search.toLowerCase();
    return customers.filter(c =>
      c.name.toLowerCase().includes(s)
      || (c.email?.toLowerCase().includes(s) ?? false)
      || (c.phone?.includes(s) ?? false)
      || (c.code?.toLowerCase().includes(s) ?? false)
    );
  }, [customers, search]);

  const stats = useMemo(() => {
    const company = customers.filter(c => c.customer_type === 'company').length;
    const individual = customers.filter(c => c.customer_type === 'individual').length;
    const vip = customers.filter(c => c.tier === 'vip').length;
    return { total: customers.length, company, individual, vip };
  }, [customers]);

  return (
    <div className="animate-fade-in p-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3 text-white">
            <Users className="w-8 h-8 text-indigo-400" />
            {t.crm.title}
          </h1>
          <p className="text-slate-400 mt-1">{t.crm.subtitle}</p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => load()}
            className="btn btn-secondary flex items-center gap-2"
            disabled={loading}
            title="Reload"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <div className="relative">
            <input
              type="text"
              placeholder={t.crm.searchPlaceholder}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-gray-800/50 border border-gray-700/50 text-white text-sm rounded-lg pl-10 pr-3 py-2.5 w-64 focus:border-indigo-500 outline-none"
            />
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
          </div>
          <button
            onClick={() => { setEditing(null); setIsModalOpen(true); }}
            className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 text-white font-medium py-2 px-4 rounded-lg shadow-lg shadow-indigo-500/20"
          >
            <UserPlus size={18} /> <span className="hidden sm:inline">{t.crm.addCustomer}</span>
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-card flex items-center gap-4 py-4 px-5">
          <div className="bg-indigo-500/20 p-3 rounded-xl border border-indigo-500/30">
            <Users className="w-6 h-6 text-indigo-400" />
          </div>
          <div>
            <p className="text-sm text-slate-400">{t.crm.totalCustomers}</p>
            <h3 className="text-2xl font-bold text-white">{stats.total}</h3>
          </div>
        </div>
        <div className="glass-card flex items-center gap-4 py-4 px-5">
          <div className="bg-blue-500/20 p-3 rounded-xl border border-blue-500/30">
            <Briefcase className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <p className="text-sm text-slate-400">{t.crm.companyCustomers}</p>
            <h3 className="text-2xl font-bold text-blue-400">{stats.company}</h3>
          </div>
        </div>
        <div className="glass-card flex items-center gap-4 py-4 px-5">
          <div className="bg-emerald-500/20 p-3 rounded-xl border border-emerald-500/30">
            <User className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <p className="text-sm text-slate-400">{t.crm.individualCustomers}</p>
            <h3 className="text-2xl font-bold text-emerald-400">{stats.individual}</h3>
          </div>
        </div>
        <div className="glass-card flex items-center gap-4 py-4 px-5">
          <div className="bg-purple-500/20 p-3 rounded-xl border border-purple-500/30">
            <Users className="w-6 h-6 text-purple-400" />
          </div>
          <div>
            <p className="text-sm text-slate-400">VIP</p>
            <h3 className="text-2xl font-bold text-purple-400">{stats.vip}</h3>
          </div>
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
          ✗ {err}
        </div>
      )}

      <div className="glass-card overflow-hidden p-0 border border-gray-800">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead className="bg-gray-800/50 border-b border-gray-700/50">
              <tr>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase tracking-wider">{t.crm.table.code}</th>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase tracking-wider">{t.crm.table.contact}</th>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase tracking-wider text-center">{t.crm.table.type}</th>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase tracking-wider text-center">{t.crm.table.tier}</th>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase tracking-wider text-right">{t.crm.table.totalSpent}</th>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase tracking-wider text-center">Orders</th>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase tracking-wider text-center">{t.common.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {loading && (
                <tr><td colSpan={7} className="py-12 text-center text-slate-500">{t.common.loading}</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="py-12 text-center text-slate-500">{t.common.noData}</td></tr>
              )}
              {!loading && filtered.map(c => (
                <tr key={c.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="py-3 px-4 text-sm font-mono text-indigo-400 align-top pt-4">
                    {c.code ?? '—'}
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-bold text-gray-100">{c.name}</div>
                    <div className="flex flex-col gap-1 mt-1 text-xs text-gray-400">
                      {c.email && (
                        <span className="flex items-center gap-1.5"><Mail size={12} className="text-gray-500" /> {c.email}</span>
                      )}
                      {c.phone && (
                        <span className="flex items-center gap-1.5"><Phone size={12} className="text-gray-500" /> {c.phone}</span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-center align-top pt-4">
                    <span className="text-gray-300 font-medium text-xs bg-gray-800 px-2.5 py-1 rounded-md border border-gray-700">
                      {c.customer_type === 'company'
                        ? <><Briefcase size={11} className="inline mr-1 text-blue-400" />บริษัท</>
                        : <><User size={11} className="inline mr-1 text-emerald-400" />บุคคล</>}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center align-top pt-4">
                    <span className={`px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider border ${TIER_STYLES[c.tier] ?? TIER_STYLES.general}`}>
                      {t.crm.tier[c.tier as keyof typeof t.crm.tier] ?? c.tier}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right align-top pt-4">
                    <span className="font-bold text-emerald-400 text-lg">
                      ฿{Number(c.total_spent).toLocaleString()}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center align-top pt-4 text-slate-300">
                    {c.total_orders}
                  </td>
                  <td className="py-3 px-4 text-center align-top pt-4">
                    <button
                      onClick={() => { setEditing(c); setIsModalOpen(true); }}
                      className="text-gray-300 hover:text-white text-sm font-medium px-3 py-1.5 rounded flex items-center gap-1 mx-auto bg-gray-700/50 border border-gray-600/50 hover:bg-indigo-500/20 hover:border-indigo-500/50 hover:text-indigo-400 transition-colors"
                    >
                      <Edit2 size={14} /> {t.common.edit}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <CustomerModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSave}
        editing={editing}
      />
    </div>
  );
}
