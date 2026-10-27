import io
import re
from typing import List
import pdfplumber


class PDFExtractionError(Exception):
    """Exception raised when PDF text extraction fails or document contains no extractable text."""
    pass


def extract_text(pdf_bytes: bytes) -> str:
    """
    Extract plaintext from uploaded PDF bytes using an in-memory BytesIO stream and pdfplumber.
    Normalizes whitespace and raises PDFExtractionError if the PDF has no extractable text.
    Never writes bytes to disk.
    """
    if not pdf_bytes:
        raise PDFExtractionError("Uploaded PDF file is empty.")

    text_pages: List[str] = []
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            if not pdf.pages:
                raise PDFExtractionError("PDF document contains no pages.")
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text and page_text.strip():
                    text_pages.append(page_text.strip())
    except Exception as exc:
        if isinstance(exc, PDFExtractionError):
            raise
        raise PDFExtractionError(f"Failed to parse PDF document structure: {str(exc)}") from exc

    combined_text = "\n\n".join(text_pages).strip()
    if not combined_text:
        raise PDFExtractionError(
            "PDF contains no extractable text. Scanned or image-only documents are not supported."
        )

    # Normalize whitespace: collapse repeated spaces/tabs and normalize newlines
    normalized = re.sub(r"[ \t]+", " ", combined_text)
    normalized = re.sub(r"\r\n|\r", "\n", normalized)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized).strip()

    if len(normalized) < 20:
        raise PDFExtractionError(
            "PDF contains insufficient text content. Please upload a standard text resume."
        )

    return normalized
