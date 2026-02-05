---
name: pdf
description: 处理 PDF 文件。用于读取、提取文本、合并或创建 PDF。
---

# PDF 处理技能

这个技能提供处理 PDF 文件的完整指南，包括读取、提取文本、合并和创建 PDF。

## 读取 PDF - 提取文本

### 方法 1: pdftotext (推荐用于快速提取)

`pdftotext` 是 Poppler 工具包的一部分，速度快且可靠：

```bash
# 提取整个 PDF 文本到 stdout
pdftotext input.pdf -

# 提取到文件
pdftotext input.pdf output.txt

# 只提取前几页（使用 -f 和 -l 参数）
pdftotext -f 1 -l 5 input.pdf output.txt
```

**安装**:
```bash
# macOS
brew install poppler

# Ubuntu/Debian
sudo apt-get install poppler-utils

# CentOS/RHEL
sudo yum install poppler-utils
```

### 方法 2: PyMuPDF (推荐用于复杂解析)

PyMuPDF (fitz) 提供更精细的控制：

```python
import fitz

# 打开 PDF
doc = fitz.open("input.pdf")

# 提取所有文本
text = ""
for page in doc:
    text += page.get_text()

# 提取特定页面
page = doc[0]  # 第一页
text = page.get_text()

# 提取表格（需要解析）
tables = page.find_tables()
for table in tables:
    df = table.to_pandas()
```

**安装**:
```bash
pip install pymupdf
```

### 方法 3: pdfplumber (推荐用于表格)

```python
import pdfplumber

with pdfplumber.open("input.pdf") as pdf:
    # 提取文本
    text = pdf.pages[0].extract_text()
    
    # 提取表格
    table = pdf.pages[0].extract_table()
    for row in table:
        print(row)
```

**安装**:
```bash
pip install pdfplumber
```

## 读取 PDF - 提取图像

```bash
# 使用 pdfimages 提取所有图像
pdfimages input.pdf output-prefix

# 只提取 JPEG 格式
pdfimages -j input.pdf output-prefix
```

## 合并 PDF

### 方法 1: PyMuPDF

```python
import fitz

# 创建新 PDF
merged_pdf = fitz.open()

# 合并多个文件
for pdf_file in ["file1.pdf", "file2.pdf", "file3.pdf"]:
    with fitz.open(pdf_file) as pdf:
        merged_pdf.insert_pdf(pdf)

# 保存
merged_pdf.save("merged.pdf")
```

### 方法 2: pdftk (命令行)

```bash
pdftk file1.pdf file2.pdf file3.pdf cat output merged.pdf
```

### 方法 3: qpdf (命令行)

```bash
qpdf --empty --pages file1.pdf file2.pdf file3.pdf -- merged.pdf
```

## 拆分 PDF

```bash
# 提取特定页面（第1-5页）
pdftk input.pdf cat 1-5 output output.pdf

# 使用 pdfseparate（每页一个文件）
pdfseparate input.pdf page-%d.pdf
```

## 创建 PDF

### 方法 1: reportlab (Python)

```python
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter

c = canvas.Canvas("output.pdf", pagesize=letter)
c.drawString(100, 750, "Hello, World!")
c.save()
```

### 方法 2: weasyprint (HTML to PDF)

```python
import weasyprint

html = """
<html>
  <body>
    <h1>Hello, World!</h1>
  </body>
</html>
"""

weasyprint.HTML(string=html).write_pdf("output.pdf")
```

### 方法 3: wkhtmltopdf (命令行)

```bash
wkhtmltopdf input.html output.pdf
```

## 获取 PDF 信息

```bash
# 使用 pdfinfo 获取元数据
pdfinfo input.pdf

# 输出示例:
# Title:          Sample PDF
# Pages:          10
# Encrypted:      no
# Page size:      595 x 842 pts (A4)
```

## OCR - 从图像 PDF 提取文本

对于扫描的 PDF 或图像：

```bash
# 使用 tesseract OCR
pdftoppm input.pdf output-prefix -png
tesseract output-prefix-1.png output-text

# 或使用 OCRmyPDF (一步完成)
ocrmypdf input.pdf output.pdf
```

## 常见任务模式

### 模式 1: 提取摘要

```bash
# 提取前1000个字符作为摘要
pdftotext input.pdf - | head -c 1000
```

### 模式 2: 搜索关键词

```bash
# 在 PDF 中搜索特定词汇
pdftotext input.pdf - | grep -i "keyword"

# 显示带行号的上下文
pdftotext input.pdf - | grep -C 3 -i "keyword"
```

### 模式 3: 批量处理

```bash
# 处理目录中的所有 PDF
for file in *.pdf; do
    pdftotext "$file" "${file%.pdf}.txt"
done
```

### 模式 4: 获取页数

```bash
# 获取 PDF 页数
pdfinfo input.pdf | grep "Pages:" | awk '{print $2}'
```

## 本技能可用资源

- **scripts/**: 辅助脚本（如果添加）
- **references/**: 相关文档和规范（如果添加）

## 故障排除

### 问题: pdftotext 命令未找到

**解决**: 安装 Poppler 工具包（见上面的安装说明）

### 问题: 文本提取为空或乱码

**原因**: PDF 可能是图像扫描版或使用了编码字体

**解决**: 
1. 使用 `pdfinfo input.pdf` 检查是否为图像 PDF
2. 尝试使用 OCR 工具（如 tesseract 或 OCRmyPDF）
3. 尝试使用 PyMuPDF 而非 pdftotext

### 问题: 表格提取不准确

**解决**: 
1. 使用 `pdfplumber` 专门处理表格
2. 尝试 `tabula-py`（基于 Java Tabula）
3. 对于复杂表格，可能需要手动调整

## 性能提示

- 对于大型 PDF，使用 `-f` 和 `-l` 参数限制处理的页面范围
- `pdftotext` 通常比 Python 库更快
- 批量处理时考虑并行化

---

**按照以上说明处理用户的 PDF 相关任务。**
