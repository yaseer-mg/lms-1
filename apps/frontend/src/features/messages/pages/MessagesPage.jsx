import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, MessageSquare, Trash2, Plus, Search, ArrowLeft } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import api             from '../../../shared/api/client';
import { useAuthStore }from '../../../shared/stores/authStore';
import { useSocketStore} from '../../../shared/stores/socketStore';
import Spinner         from '../../../shared/components/ui/spinner';
import Modal           from '../../../shared/components/ui/modal';
import toast           from 'react-hot-toast';
import { clsx }        from 'clsx';
import { offlineMutation } from '../../../shared/offline/mutations';

export default function MessagesPage() {
  const { user }              = useAuthStore();
  const socket                = useSocketStore(s => s.socket);
  const queryClient           = useQueryClient();
  const [activeConv, setConv] = useState(null);
  const [text, setText]       = useState('');
  const [isTyping, setTyping] = useState(false);
  const bottomRef             = useRef(null);
  const typingTimer           = useRef(null);
  const [showCompose, setShowCompose] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [composeContact, setComposeContact] = useState(null);
  const [composeText, setComposeText] = useState('');

  // Conversations list
  const { data: convs = [], isLoading: convsLoading } = useQuery({
    queryKey: ['conversations'],
    queryFn:  () => api.get('/messages').then(r => r.data.data.conversations),
    refetchInterval: 15000,
  });

  // Available contacts (people the user can message)
  const { data: contacts = [] } = useQuery({
    queryKey: ['message-contacts', contactSearch],
    queryFn:  () => api.get(`/messages/contacts?search=${encodeURIComponent(contactSearch)}`).then(r => r.data.data.contacts),
    enabled:  showCompose,
  });

  // Messages in active conversation
  const { data: msgData } = useQuery({
    queryKey: ['messages', activeConv?.conversation_id],
    queryFn:  () => api.get(`/messages/${activeConv.conversation_id}/messages`).then(r => r.data),
    enabled:  !!activeConv?.conversation_id,
    refetchInterval: 5000,
  });
  const messages = msgData?.data || [];

  // Real-time: new message
  useEffect(() => {
    if (!socket || !activeConv) return;
    socket.emit('join_dm', { conversationId: activeConv.conversation_id });
    const handler = ({ message }) => {
      queryClient.invalidateQueries({ queryKey: ['messages', activeConv.conversation_id] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    };
    socket.on('new_message', handler);
    return () => { socket.off('new_message', handler); };
  }, [socket, activeConv, queryClient]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Send message
  const sendMutation = useMutation(offlineMutation('message-send', {
    onSuccess: (_data, vars) => {
      setText('');
      queryClient.invalidateQueries({ queryKey: ['messages', activeConv?.conversation_id] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  }));

  const deleteMut = useMutation(offlineMutation('message-delete', {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', activeConv?.conversation_id] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to delete'),
  }));

  const handleSend = () => {
    const content = text.trim();
    if (!content || sendMutation.isPending || !activeConv) return;
    sendMutation.mutate({ recipientId: activeConv.other_user_id, content });
  };

  const handleTyping = (val) => {
    setText(val);
    if (!socket || !activeConv) return;
    if (!isTyping) {
      setTyping(true);
      socket.emit('dm_typing', { conversationId: activeConv.conversation_id, userId: user.id, isTyping: true });
    }
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      setTyping(false);
      socket.emit('dm_typing', { conversationId: activeConv.conversation_id, userId: user.id, isTyping: false });
    }, 1500);
  };

  return (
    <><div className="flex h-[calc(100vh-130px)] card p-0 overflow-hidden">

      {/* Conversations sidebar */}
      <div className={clsx('w-72 flex-shrink-0 border-r border-gray-700 flex-col', activeConv ? 'hidden lg:flex' : 'flex')}>
        <div className="p-4 border-b border-gray-700 flex items-center justify-between">
          <h2 className="font-semibold text-white">Messages</h2>
          <button onClick={() => setShowCompose(true)}
            className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
            title="New message">
            <Plus size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {convsLoading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : convs.length === 0 ? (
            <div className="text-center py-10 px-4">
              <MessageSquare size={32} className="text-gray-700 mx-auto mb-2" />
              <p className="text-gray-500 text-sm">No conversations yet</p>
            </div>
          ) : (
            convs.map(conv => (
              <button
                key={conv.conversation_id}
                onClick={() => setConv(conv)}
                className={clsx(
                  'w-full flex items-start gap-3 p-4 text-left',
                  'border-b border-gray-800/50 hover:bg-white/3 transition-colors',
                  activeConv?.conversation_id === conv.conversation_id && 'bg-[#1A6FBF]/10'
                )}
              >
                <div className="w-9 h-9 rounded-full bg-[#1A6FBF] flex items-center
                                justify-center text-white text-xs font-bold flex-shrink-0">
                  {conv.other_user_name?.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-white truncate">
                      {conv.other_user_name}
                    </p>
                    {conv.unread_count > 0 && (
                      <span className="badge-blue badge ml-1">{conv.unread_count}</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate mt-0.5">
                    {conv.last_message || 'No messages yet'}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Chat area */}
      {activeConv ? (
        <div className="flex-1 flex flex-col min-w-0">

          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-700">
            <button onClick={() => setConv(null)}
                    className="lg:hidden p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                    title="Back to conversations">
              <ArrowLeft size={18} />
            </button>
            <div className="w-8 h-8 rounded-full bg-[#1A6FBF] flex items-center
                            justify-center text-white text-xs font-bold">
              {activeConv.other_user_name?.charAt(0)}
            </div>
            <div>
              <p className="text-sm font-semibold text-white">
                {activeConv.other_user_name}
              </p>
              <p className="text-xs text-gray-500 capitalize">
                {activeConv.other_user_role}
              </p>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            {messages.map(msg => {
              const isMe = msg.sender_id === user?.id;
              return (
                <div key={msg.id} className={clsx('group flex', isMe && 'justify-end')}>
                  <div className={clsx(
                    'relative max-w-xs lg:max-w-sm px-4 py-2.5 rounded-2xl text-sm',
                    isMe
                      ? 'bg-[#1A6FBF] text-white rounded-br-sm'
                      : 'bg-[#112236] text-gray-200 rounded-bl-sm border border-gray-700'
                  )}>
                    <p className="leading-relaxed">{msg.content}</p>
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <p className={clsx(
                        'text-xs',
                        isMe ? 'text-blue-200' : 'text-gray-500'
                      )}>
                        {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true })}
                      </p>
                      {isMe && (
                        <button
                          onClick={() => {
                            if (confirm('Delete this message?'))
                              deleteMut.mutate({ convId: activeConv.conversation_id, msgId: msg.id });
                          }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/10 transition-opacity"
                          title="Delete"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="flex items-center gap-3 p-4 border-t border-gray-700">
            <input
              value={text}
              onChange={e => handleTyping(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
              placeholder="Type a message…"
              className="input flex-1 py-2.5 text-sm"
            />
            <button
              onClick={handleSend}
              disabled={!text.trim() || sendMutation.isPending}
              className="btn-primary p-2.5 rounded-xl disabled:opacity-50"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      ) : (
        <div className="hidden lg:flex flex-1 items-center justify-center text-gray-600 flex-col gap-3">
          <MessageSquare size={40} />
          <p className="text-sm">Select a conversation to start messaging</p>
        </div>
      )}
    </div>

      {/* New Message modal */}
      <Modal open={showCompose} onClose={() => {
        setShowCompose(false); setContactSearch(''); setComposeContact(null); setComposeText('');
      }} title={composeContact ? `Message ${composeContact.first_name}` : 'New Message'} size="sm">
        {composeContact ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 pb-3 border-b border-gray-700">
              <button onClick={() => { setComposeContact(null); setComposeText(''); }}
                className="text-gray-400 hover:text-white text-sm">Back</button>
              <div className="w-8 h-8 rounded-full bg-[#1A6FBF] flex items-center
                              justify-center text-white text-xs font-bold flex-shrink-0">
                {composeContact.first_name?.charAt(0)}
              </div>
              <div>
                <p className="text-sm font-medium text-white">{composeContact.first_name} {composeContact.last_name}</p>
                <p className="text-xs text-gray-500 capitalize">{composeContact.role}</p>
              </div>
            </div>
            <textarea
              value={composeText}
              onChange={e => setComposeText(e.target.value)}
              placeholder="Type your message…"
              rows={4}
              className="input w-full resize-none"
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <button onClick={() => { setShowCompose(false); setComposeContact(null); setComposeText(''); }}
                className="btn-ghost px-4 py-2 rounded-xl text-sm">Cancel</button>
              <button
                onClick={() => {
                  if (!composeText.trim()) return;
                  setShowCompose(false);
                  setComposeContact(null);
                  sendMutation.mutate(
                    { recipientId: composeContact.id, content: composeText.trim() },
                  );
                  setComposeText('');
                }}
                disabled={!composeText.trim() || sendMutation.isPending}
                className="btn-primary px-4 py-2 rounded-xl flex items-center gap-2 text-sm disabled:opacity-50"
              >
                <Send size={14} />
                {sendMutation.isPending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                value={contactSearch}
                onChange={e => setContactSearch(e.target.value)}
                placeholder="Search contacts…"
                className="input w-full pl-9 py-2 text-sm"
                autoFocus
              />
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {contacts.length === 0 ? (
                <p className="text-center py-8 text-gray-500 text-sm">No contacts found</p>
              ) : (
                contacts.map(contact => (
                  <button
                    key={contact.id}
                    onClick={() => setComposeContact(contact)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors text-left"
                  >
                    <div className="w-8 h-8 rounded-full bg-[#1A6FBF] flex items-center
                                    justify-center text-white text-xs font-bold flex-shrink-0">
                      {contact.first_name?.charAt(0)}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{contact.first_name} {contact.last_name}</p>
                      <p className="text-xs text-gray-500 capitalize">{contact.role}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}