import React, { useState, useRef } from 'react';
import { Upload, FileText, CheckCircle2, AlertCircle, X, Plus, Sparkles, Briefcase } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiClient, ApiError } from '@/lib/api';

export interface WorkHistoryItem {
  company: string;
  title: string;
  duration?: string;
  start?: string;
  end?: string;
  description?: string;
  highlights?: string[];
}

export interface EducationItem {
  degree: string;
  institution: string;
  year?: string;
}

export interface ParsedProfileData {
  skills?: string[];
  technical_skills?: string[];
  experience_years?: number;
  work_history?: WorkHistoryItem[];
  experience?: WorkHistoryItem[];
  education?: EducationItem[];
  summary?: string;
}

export interface ResumeData {
  id: string;
  user_id?: string;
  filename: string;
  file_size: number;
  raw_text?: string;
  parsed_data?: ParsedProfileData;
  parsed_profile?: ParsedProfileData;
  created_at: string;
}

interface ResumeUploadDropzoneProps {
  onParsed: (resume: ResumeData) => void;
  selectedResume: ResumeData | null;
}

export function ResumeUploadDropzone({
  onParsed,
  selectedResume,
}: ResumeUploadDropzoneProps): React.ReactElement {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [newSkillInput, setNewSkillInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Extract skills safely across both parsed_data and parsed_profile aliases
  const parsedData: ParsedProfileData = selectedResume?.parsed_data || selectedResume?.parsed_profile || {};
  const skills: string[] = (
    Array.isArray(parsedData.skills) && parsedData.skills.length > 0
      ? parsedData.skills
      : Array.isArray(parsedData.technical_skills)
      ? parsedData.technical_skills
      : []
  ).filter(Boolean);

  // Extract work history / experiences safely
  const rawExperiences = (
    Array.isArray(parsedData.experience) && parsedData.experience.length > 0
      ? parsedData.experience
      : Array.isArray(parsedData.work_history)
      ? parsedData.work_history
      : []
  );

  const experiences = rawExperiences.map((exp) => {
    const duration = exp.duration || (exp.start ? `${exp.start} - ${exp.end || 'Present'}` : undefined);
    const desc = exp.description || (Array.isArray(exp.highlights) ? exp.highlights.join('; ') : '');
    return {
      title: exp.title || 'Role',
      company: exp.company || 'Company',
      duration,
      description: desc,
    };
  });

  const summary = parsedData.summary || '';

  const handleFile = async (file: File) => {
    setUploadError(null);

    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setUploadError('Only PDF documents (.pdf) are supported.');
      return;
    }

    const maxBytes = 5 * 1024 * 1024;
    if (file.size > maxBytes) {
      setUploadError('File size exceeds the 5MB maximum limit.');
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const data = await apiClient.post<ResumeData>('/api/v1/resumes/upload', formData);
      onParsed(data);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to parse resume PDF.';
      setUploadError(msg);
    } finally {
      setIsUploading(false);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const addCustomSkill = async () => {
    if (!newSkillInput.trim() || !selectedResume) return;
    const skillName = newSkillInput.trim();
    if (skills.includes(skillName)) return;

    const updatedSkills = [...skills, skillName];
    try {
      const updated = await apiClient.patch<ResumeData>(
        `/api/v1/resumes/${selectedResume.id}`,
        { skills: updatedSkills }
      );
      onParsed(updated);
      setNewSkillInput('');
    } catch {
      onParsed({
        ...selectedResume,
        parsed_data: {
          ...parsedData,
          skills: updatedSkills,
          technical_skills: updatedSkills,
        },
      });
      setNewSkillInput('');
    }
  };

  const removeSkill = async (skillToRemove: string) => {
    if (!selectedResume) return;
    const updatedSkills = skills.filter((s) => s !== skillToRemove);
    try {
      const updated = await apiClient.patch<ResumeData>(
        `/api/v1/resumes/${selectedResume.id}`,
        { skills: updatedSkills }
      );
      onParsed(updated);
    } catch {
      onParsed({
        ...selectedResume,
        parsed_data: {
          ...parsedData,
          skills: updatedSkills,
          technical_skills: updatedSkills,
        },
      });
    }
  };

  return (
    <div className="space-y-6">
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
          isDragging
            ? 'border-indigo-500 bg-indigo-950/40 scale-[1.01]'
            : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900/80'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              handleFile(e.target.files[0]);
            }
          }}
        />

        <div className="flex flex-col items-center justify-center space-y-3">
          <div className="p-3.5 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
            {isUploading ? (
              <span className="h-6 w-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin block" />
            ) : (
              <Upload className="h-6 w-6" />
            )}
          </div>

          <div>
            <p className="text-base font-semibold text-white">
              {isUploading ? 'Parsing Resume PDF with pdfplumber & AI...' : 'Drop your resume PDF here or browse'}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Supports PDF documents up to 5MB. Skills and experience are parsed automatically.
            </p>
          </div>
        </div>
      </div>

      {uploadError && (
        <div className="p-3.5 rounded-lg bg-rose-950/60 border border-rose-800/80 text-rose-200 text-xs flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
          <span>{uploadError}</span>
        </div>
      )}

      {selectedResume && (
        <Card className="border-indigo-900/60 bg-indigo-950/20 backdrop-blur-md">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-indigo-400" />
                <CardTitle className="text-base text-white">
                  Parsed Resume: {selectedResume.filename}
                </CardTitle>
              </div>
              <Badge variant="success" className="gap-1 font-mono text-xs">
                <CheckCircle2 className="h-3 w-3" />
                Parsed ({((selectedResume.file_size || 0) / 1024).toFixed(1)} KB)
              </Badge>
            </div>
            {summary && (
              <CardDescription className="text-slate-300 text-xs mt-2 italic">
                "{summary}"
              </CardDescription>
            )}
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                  Target Skills Grounding ({skills.length})
                </span>
                <span className="text-[11px] text-slate-400">Click x to remove or add custom below</span>
              </div>

              {skills.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {skills.map((skill) => (
                    <span
                      key={skill}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-indigo-950/90 text-indigo-200 border border-indigo-800/80 shadow-sm"
                    >
                      {skill}
                      <button
                        type="button"
                        onClick={() => removeSkill(skill)}
                        className="text-indigo-400 hover:text-rose-300 transition-colors"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 italic">No technical skills detected yet. You can add skills manually below.</p>
              )}

              <div className="flex gap-2 pt-1">
                <input
                  type="text"
                  placeholder="Add another skill..."
                  value={newSkillInput}
                  onChange={(e) => setNewSkillInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addCustomSkill();
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-950/80 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={addCustomSkill}
                  className="h-8 text-xs text-slate-300 gap-1 border-slate-700 bg-slate-900"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Skill
                </Button>
              </div>
            </div>

            {experiences.length > 0 && (
              <div className="pt-2 border-t border-slate-800/80">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 mb-2">
                  <Briefcase className="h-3.5 w-3.5 text-indigo-400" />
                  Work Experience Highlights ({experiences.length})
                </span>
                <div className="space-y-2 text-xs text-slate-400">
                  {experiences.map((exp, idx) => (
                    <div key={idx} className="p-2.5 rounded-lg bg-slate-950/40 border border-slate-800/60 space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-slate-200">{exp.title}</span>
                        {exp.duration && <span className="text-[11px] font-mono text-slate-400">{exp.duration}</span>}
                      </div>
                      <div className="text-indigo-300 font-medium text-[11px]">{exp.company}</div>
                      {exp.description && (
                        <p className="text-slate-400 text-[11px] line-clamp-2 mt-0.5">{exp.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
