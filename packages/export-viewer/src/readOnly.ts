import type { Thread } from '@hpe/shared';
import type { ThreadActor } from '@web/features/comments/permissions';
import type { ThreadActions } from '@web/features/comments/types';

/** 匯出檔沒有身分：viewer 角色、不能留言。 */
export const READ_ONLY_ACTOR: ThreadActor = { me: null, role: 'viewer' };

const READ_ONLY_MESSAGE = '匯出檔為唯讀。';
const reject = (): Promise<never> => Promise.reject(new Error(READ_ONLY_MESSAGE));

/** 所有寫入動作都 reject（元件在 viewer 角色下本來就不會顯示它們）。 */
export const READ_ONLY_ACTIONS: ThreadActions = {
  onReply: reject,
  onSetStatus: reject,
  onSetTags: reject,
  onEditComment: reject,
  onDeleteComment: reject,
  onCopyLink: reject,
};

export const rejectCreateThread = (): Promise<Thread> => reject();
