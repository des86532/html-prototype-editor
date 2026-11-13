import { authorId, type Author, type Comment, type Role } from '@hpe/shared';

export interface ThreadActor {
  /** 目前身分；擁有者為 user、已留名的訪客為 guest、否則 null */
  me: Author | null;
  role: Role;
}

/** viewer 角色不能留言；commenter 還需要先填名字（me 不為 null）。 */
export function canComment(actor: ThreadActor): boolean {
  if (actor.role === 'viewer') return false;
  return actor.me !== null;
}

function isOwn(actor: ThreadActor, c: Comment): boolean {
  return actor.me !== null && authorId(actor.me) === authorId(c.author);
}

/** commenter 只能編輯自己的留言（擁有者也只能編輯自己的）。 */
export function canEditComment(actor: ThreadActor, c: Comment): boolean {
  return canComment(actor) && isOwn(actor, c);
}

/** 擁有者可刪除任何留言；commenter 只能刪自己的。 */
export function canDeleteComment(actor: ThreadActor, c: Comment): boolean {
  if (actor.role === 'owner') return true;
  return canComment(actor) && isOwn(actor, c);
}
