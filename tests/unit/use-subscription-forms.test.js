import { describe, it, expect, vi } from 'vitest';
import { useSubscriptionForms } from '../../src/composables/useSubscriptionForms.js';

vi.mock('../../src/stores/toast.js', () => ({
  useToastStore: () => ({
    showToast: vi.fn()
  })
}));

describe('useSubscriptionForms', () => {
  it('新增订阅源时默认使用默认 UA（customUserAgent 为空）', () => {
    const { openAdd, editingSubscription } = useSubscriptionForms({
      addSubscription: vi.fn(),
      updateSubscription: vi.fn()
    });

    openAdd();

    expect(editingSubscription.value.customUserAgent).toBe('');
  });

  it('新增订阅源时保护性缓存节点默认关闭', () => {
    const { openAdd, editingSubscription } = useSubscriptionForms({
      addSubscription: vi.fn(),
      updateSubscription: vi.fn()
    });

    openAdd();

    expect(editingSubscription.value.enableNodeCache).toBe(false);
  });

  it('新增订阅源时初始化空的 operators 数组', () => {
    const { openAdd, editingSubscription } = useSubscriptionForms({
      addSubscription: vi.fn(),
      updateSubscription: vi.fn()
    });

    openAdd();

    expect(editingSubscription.value.operators).toEqual([]);
  });

  it('编辑时把非数组 operators 归一化，并在保存时写回', () => {
    const updateSubscription = vi.fn();
    const { openEdit, handleSave, editingSubscription } = useSubscriptionForms({
      addSubscription: vi.fn(),
      updateSubscription
    });

    openEdit({ id: 'sub-1', name: 'Test', url: 'https://example.com/sub', operators: null });
    expect(editingSubscription.value.operators).toEqual([]);

    handleSave();

    expect(updateSubscription).toHaveBeenCalledWith(expect.objectContaining({
      id: 'sub-1',
      operators: []
    }));
  });
});
