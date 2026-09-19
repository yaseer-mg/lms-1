import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { User, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../shared/api/client';
import { useAuthStore } from '../../../shared/stores/authStore';
import Input, { Textarea } from '../../../shared/components/ui/input';
import Button from '../../../shared/components/ui/Button';
import { offlineMutation } from '../../../shared/offline/mutations';

export default function ProfilePage() {
  const { user, updateUser } = useAuthStore();
  const queryClient = useQueryClient();

  const { data: profile } = useQuery({
    queryKey: ['my-profile'],
    queryFn: () => api.get('/users/profile').then(r => r.data.data),
  });

  const { register, handleSubmit, formState: { errors } } = useForm({
    values: {
      firstName: profile?.user?.first_name || user?.first_name || '',
      lastName:  profile?.user?.last_name  || user?.last_name  || '',
      headline:  profile?.user?.headline   || '',
      bio:       profile?.user?.bio        || '',
    },
  });

  const updateMutation = useMutation(offlineMutation('profile-update', {
    onSuccess: (res) => {
      toast.success('Profile updated');
      updateUser(res.data.data?.user || { first_name: res.data.data?.firstName });
      queryClient.invalidateQueries({ queryKey: ['my-profile'] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Update failed'),
  }));

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="font-display font-bold text-2xl text-white">Profile Settings</h1>
        <p className="text-gray-400 text-sm mt-1">Manage your personal information</p>
      </div>

      <div className="card">
        <form onSubmit={handleSubmit((d) => updateMutation.mutate(d))} className="flex flex-col gap-4">
          <div className="flex items-center gap-4 mb-2">
            <div className="w-16 h-16 rounded-full bg-[#1A6FBF] flex items-center justify-center text-white text-xl font-bold">
              {user?.first_name?.[0] || user?.email?.[0]?.toUpperCase() || '?'}{user?.last_name?.[0] || ''}
            </div>
            <div>
              <p className="text-white font-semibold">{user?.first_name} {user?.last_name}</p>
              <p className="text-gray-500 text-sm capitalize">{user?.role}</p>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <Input label="First name" error={errors.firstName?.message}
              {...register('firstName', { required: 'Required' })} />
            <Input label="Last name" error={errors.lastName?.message}
              {...register('lastName', { required: 'Required' })} />
          </div>

          <Input label="Headline"
            {...register('headline')} placeholder="e.g. Full-stack developer" />

          <Textarea label="Bio" rows={4}
            {...register('bio')} placeholder="Tell us about yourself…" />

          <div className="flex justify-end pt-2">
            <Button type="submit" loading={updateMutation.isPending}>
              <Save size={16} /> Save Changes
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
