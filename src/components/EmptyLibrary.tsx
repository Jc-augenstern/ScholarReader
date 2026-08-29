import { FilePlus2, FolderOpen } from "lucide-react";

type EmptyLibraryProps = {
  importing: boolean;
  onAdd: () => void;
};

export function EmptyLibrary({ importing, onAdd }: EmptyLibraryProps) {
  return (
    <div className="empty-state">
      <div className="empty-illustration" aria-hidden="true">
        <FolderOpen size={30} strokeWidth={1.5} />
        <span>
          <FilePlus2 size={18} />
        </span>
      </div>
      <h2>建立你的学习资料库</h2>
      <p>添加论文、教材或课程讲义。ScholarReader 只记录路径，不会复制或修改原文件。</p>
      <button className="primary-button large" disabled={importing} onClick={onAdd} type="button">
        <FilePlus2 size={18} />
        {importing ? "正在添加…" : "添加第一个 PDF"}
      </button>
      <small>支持一次选择多个 PDF</small>
    </div>
  );
}
