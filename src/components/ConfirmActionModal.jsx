import { AlertTriangle, X } from 'lucide-react';
import { useBotStore } from '../store/useBotStore';

export default function ConfirmActionModal() {
  const { confirmActionModal, closeConfirmModal } = useBotStore();

  if (!confirmActionModal.isOpen) return null;

  const { title, message, onConfirm } = confirmActionModal;

  const handleConfirm = async () => {
    try {
      if (typeof onConfirm === 'function') {
        await onConfirm();
      }
    } finally {
      closeConfirmModal();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      onClick={closeConfirmModal}
    >
      <div
        className="w-full max-w-sm bg-[#131722] border border-red-500/30 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 bg-gradient-to-r from-red-950/40 to-[#131722] border-b border-[#1e2638] flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-red-400">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <h3 className="font-bold text-white text-sm">{title || 'Confirmar Ação'}</h3>
          </div>
          <button
            onClick={closeConfirmModal}
            className="p-1 rounded-lg text-[#64748b] hover:text-white hover:bg-white/5 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 text-xs text-[#94a3b8] leading-relaxed">
          {message || 'Você tem certeza que deseja prosseguir com esta ação destrutiva?'}
        </div>

        <div className="p-3 bg-[#0d1017] border-t border-[#1e2638] flex justify-end gap-2">
          <button
            onClick={closeConfirmModal}
            className="px-3.5 py-1.5 bg-[#181f2e] hover:bg-[#222b3d] text-[#94a3b8] hover:text-white rounded-lg text-xs font-semibold border border-[#2a3449] cursor-pointer"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-bold shadow-lg shadow-red-600/30 cursor-pointer"
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}
