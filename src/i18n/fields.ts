const en = {
  insertStart: 'Add field at start', insertAfter: 'Add field after', reorder: 'Reorder',
  reorderHint: 'Drag to reorder, or use the Up and Down arrow keys. Home moves to the start. End moves to the end.',
  moved: (name: string, position: number, count: number) => `${name} moved to position ${position} of ${count}.`,
};

const zh: typeof en = {
  insertStart: '在开头添加字段', insertAfter: '在此字段后添加', reorder: '调整顺序',
  reorderHint: '拖动以调整顺序，也可使用上下方向键。Home 移至开头，End 移至末尾。',
  moved: (name: string, position: number, count: number) => `${name} 已移至第 ${position} 项，共 ${count} 项。`,
};

export const fieldCopy = { en, zh };
