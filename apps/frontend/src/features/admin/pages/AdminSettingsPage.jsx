import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings, Save, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../shared/api/client';
import Spinner from '../../../shared/components/ui/spinner';
import Button from '../../../shared/components/ui/Button';
import Input from '../../../shared/components/ui/input';

export default function AdminSettingsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => api.get('/admin/settings').then(r => r.data.data.settings),
  });

  const saveMutation = useMutation({
    mutationFn: (body) => api.put('/admin/settings', body),
    onSuccess: () => {
      toast.success('Settings saved');
      queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      queryClient.invalidateQueries({ queryKey: ['institution-settings'] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to save settings'),
  });

  const logoUploadMut = useMutation({
    mutationFn: (file) => {
      const fd = new FormData();
      fd.append('logo', file);
      return api.post('/admin/settings/logo', fd);
    },
    onSuccess: (res) => {
      toast.success('Logo uploaded');
      queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      queryClient.invalidateQueries({ queryKey: ['institution-settings'] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Logo upload failed'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    saveMutation.mutate(Object.fromEntries(fd));
  };

  if (isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;

  const s = data || {};

  const fields = [
    { key: 'institution_name',    label: 'Institution Name',    type: 'text' },
    { key: 'institution_tagline', label: 'Tagline',             type: 'text' },
    { key: 'institution_email',    label: 'Email',               type: 'email' },
    { key: 'institution_phone',    label: 'Phone',               type: 'text' },
    { key: 'institution_address',  label: 'Address',             type: 'text' },
    { key: 'institution_website',  label: 'Website',             type: 'url' },
    { key: 'academic_year',        label: 'Academic Year',       type: 'text' },
    { key: 'default_timezone',     label: 'Default Timezone',    type: 'text' },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display font-bold text-2xl text-white">Institution Settings</h1>
        <p className="text-gray-400 text-sm mt-1">Manage platform-wide configuration</p>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl flex flex-col gap-4">

        {/* Logo upload */}
        <div className="card">
          <label className="text-sm font-medium text-gray-300 mb-2 block">Institution Logo</label>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="w-16 h-16 bg-[#1A6FBF] rounded-xl flex items-center justify-center overflow-hidden shrink-0">
              {s.institution_logo_url ? (
                <img src={s.institution_logo_url} alt="Logo" className="w-full h-full object-cover" />
              ) : (
                <Settings size={24} className="text-white" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <input type="file" accept="image/*" onChange={e => {
                if (e.target.files[0]) logoUploadMut.mutate(e.target.files[0]);
              }} className="max-w-full text-sm text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-[#1A6FBF] file:text-white file:text-sm" />
              {logoUploadMut.isPending && <Spinner size="sm" />}
              {s.institution_logo_url && (
                <p className="text-xs text-gray-500 mt-1 break-all">Current logo URL: {s.institution_logo_url}</p>
              )}
            </div>
          </div>
        </div>

        {fields.map(({ key, label, type }) => (
          <Input key={key} label={label} name={key} type={type}
            defaultValue={s[key] || ''} />
        ))}
        <div className="flex justify-end pt-2">
          <Button type="submit" loading={saveMutation.isPending}>
            <Save size={16} /> Save Settings
          </Button>
        </div>
      </form>
    </div>
  );
}
