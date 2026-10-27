/**
 * Transcript Stitcher & Deduplication Engine
 *
 * Browsers (especially Chrome) periodically abort or reset WebSpeech sessions
 * every 60 seconds or after silence. This class maintains an append-only
 * ground-truth transcript and stitches interim and new final segments without
 * duplicating words or phrase overlaps across recognition restarts.
 */

export class TranscriptStitcher {
  private finalSegments: string[] = [];
  private currentInterim: string = '';

  /**
   * Resets the entire stitched transcript.
   */
  public reset(): void {
    this.finalSegments = [];
    this.currentInterim = '';
  }

  /**
   * Appends an incoming transcript chunk from the STT provider.
   * If `isFinal` is true, commits the segment to the finalized history after
   * removing any overlapping suffix/prefix words with the prior segment.
   *
   * @param chunk The raw text received from the recognition engine.
   * @param isFinal Whether this chunk has been marked as final by the recognizer.
   * @returns An object containing the consolidated current transcript.
   */
  public append(chunk: string, isFinal: boolean): { fullTranscript: string; isNew: boolean } {
    const cleaned = chunk.trim();
    if (!cleaned) {
      return {
        fullTranscript: this.getFullTranscript(),
        isNew: false,
      };
    }

    if (isFinal) {
      this.currentInterim = '';
      const deduplicated = this.deduplicateOverlap(cleaned);
      if (deduplicated) {
        this.finalSegments.push(deduplicated);
        return {
          fullTranscript: this.getFullTranscript(),
          isNew: true,
        };
      }
      return {
        fullTranscript: this.getFullTranscript(),
        isNew: false,
      };
    } else {
      this.currentInterim = cleaned;
      return {
        fullTranscript: this.getFullTranscript(),
        isNew: true,
      };
    }
  }

  /**
   * Removes overlapping words from the start of `newChunk` that already exist
   * at the end of the last finalized segment.
   */
  public deduplicateOverlap(newChunk: string): string {
    if (this.finalSegments.length === 0) {
      return newChunk;
    }

    const lastFinal = this.finalSegments[this.finalSegments.length - 1];
    const prevWords = lastFinal.split(/\s+/).map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ''));
    const newWords = newChunk.split(/\s+/);
    const newWordsNormalized = newWords.map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ''));

    // Check overlaps from longest possible match (up to 8 words) down to 1
    const maxCheck = Math.min(prevWords.length, newWordsNormalized.length, 8);
    for (let len = maxCheck; len >= 1; len--) {
      const prevSuffix = prevWords.slice(-len).join(' ');
      const newPrefix = newWordsNormalized.slice(0, len).join(' ');
      if (prevSuffix === newPrefix && prevSuffix.length > 0) {
        // Matched overlap, return remaining tokens
        const remainingTokens = newWords.slice(len);
        return remainingTokens.join(' ').trim();
      }
    }

    return newChunk;
  }

  /**
   * Returns the consolidated full transcript including both finalized segments
   * and the current active interim result.
   */
  public getFullTranscript(): string {
    const finalPart = this.finalSegments.join(' ').trim();
    if (this.currentInterim) {
      return finalPart ? `${finalPart} ${this.currentInterim}` : this.currentInterim;
    }
    return finalPart;
  }

  /**
   * Returns only finalized text (excluding pending interim).
   */
  public getFinalTranscript(): string {
    return this.finalSegments.join(' ').trim();
  }

  /**
   * Returns the total word count of the current transcript.
   */
  public getWordCount(): number {
    const full = this.getFullTranscript();
    if (!full) return 0;
    return full.split(/\s+/).filter(Boolean).length;
  }
}
