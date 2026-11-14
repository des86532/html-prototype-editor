/** 四角裁切標記；父元素必須是 `relative`。 */
export function CropMarks() {
  return (
    <div aria-hidden="true" className="crop-marks">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}
