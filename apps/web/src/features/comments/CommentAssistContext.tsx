import { createContext } from 'react';

export interface MentionCandidate {
  id: string;
  name: string;
}

export interface CommentAssist {
  /** @ 清單（不含自己），依顯示順序 */
  candidates: readonly MentionCandidate[];
  /** 渲染時要醒目的名字（含自己） */
  names: readonly string[];
}

/** 留言輸入與顯示共用：@ 提及的候選人，以及顯示時要醒目的名字。 */
export const CommentAssistContext = createContext<CommentAssist>({ candidates: [], names: [] });
