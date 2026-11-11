import type { BuiltInCategory, Category, Field, FieldKind, Locale, ProfileRecord } from './types';

export const categories: BuiltInCategory[] = ['identity', 'education', 'experience', 'research', 'awards', 'skills', 'contacts', 'documents', 'custom'];

export const categoryLabels: Record<BuiltInCategory, { en: string; zh: string }> = {
  identity: { en: 'Identity', zh: '个人信息' },
  education: { en: 'Education', zh: '教育经历' },
  experience: { en: 'Experience', zh: '工作经历' },
  research: { en: 'Research', zh: '项目与研究' },
  awards: { en: 'Awards', zh: '荣誉奖励' },
  skills: { en: 'Skills', zh: '技能证书' },
  contacts: { en: 'Contacts', zh: '家庭与联系人' },
  documents: { en: 'Documents', zh: '文件资料' },
  custom: { en: 'Custom', zh: '自定义' },
};

type TemplateField = Omit<Field, 'id' | 'value'>;

interface RecordTemplate {
  id: string;
  category: Category;
  name: { en: string; zh: string };
  description: { en: string; zh: string };
  fields: TemplateField[];
}

function field(label: string, labelZh: string, kind: FieldKind = 'text', sensitive = false): TemplateField {
  return { label, labelZh, kind, sensitive };
}

export const templates: RecordTemplate[] = [
  {
    id: 'identity',
    category: 'identity',
    name: { en: 'Personal identity', zh: '基本身份信息' },
    description: { en: 'Names, identity documents and personal details.', zh: '姓名、身份证件和基本资料。' },
    fields: [
      field('Full name', '姓名'),
      field('Family name (Latin)', '姓拼音'),
      field('Given name (Latin)', '名拼音'),
      field('Former name', '曾用名'),
      field('Gender', '性别'),
      field('Date of birth', '出生日期', 'date', true),
      field('Nationality', '国籍'),
      field('ID type', '证件类型'),
      field('ID number', '证件号码', 'text', true),
      field('Issuing country', '签发国家或地区'),
      field('Personal summary', '个人简介', 'multiline'),
    ],
  },
  {
    id: 'contact',
    category: 'identity',
    name: { en: 'Contact details', zh: '联系方式' },
    description: { en: 'Phone, email, social accounts and addresses.', zh: '电话、邮箱、社交账号和地址。' },
    fields: [
      field('Dialing code', '电话区号'),
      field('Mobile', '手机', 'phone', true),
      field('Email', '电子邮箱', 'email'),
      field('QQ', 'QQ 号', 'text', true),
      field('WeChat', '微信号', 'text', true),
      field('Home phone', '家庭电话', 'phone', true),
      field('Current city', '现居城市'),
      field('Home address', '家庭地址', 'multiline', true),
      field('Street or township', '街道或乡镇', 'text', true),
      field('Postal code', '邮政编码'),
      field('Website', '个人网站', 'url'),
    ],
  },
  {
    id: 'administrative',
    category: 'identity',
    name: { en: 'Administrative profile', zh: '学籍与行政资料' },
    description: { en: 'Household registration, health and administrative forms.', zh: '户籍、健康和行政表格所需资料。' },
    fields: [
      field('Ethnicity', '民族', 'text', true),
      field('Birthplace', '籍贯'),
      field('Political affiliation', '政治面貌', 'text', true),
      field('Membership date and place', '入团或入党时间地点', 'multiline', true),
      field('Marital status', '婚姻状况', 'text', true),
      field('Household registration', '户口所在地', 'text', true),
      field('Household type', '户口类别', 'text', true),
      field('Height (cm)', '身高（厘米）', 'text', true),
      field('Weight (kg)', '体重（千克）', 'text', true),
      field('Blood type', '血型', 'text', true),
      field('Health', '健康状况', 'multiline', true),
      field('Household circumstances', '家庭情况', 'multiline', true),
      field('Monthly income per person', '家庭人均月收入', 'text', true),
      field('Financial assistance', '家庭经济困难申请', 'text', true),
    ],
  },
  {
    id: 'education',
    category: 'education',
    name: { en: 'Education', zh: '教育经历' },
    description: { en: 'One school, degree or study period.', zh: '一所学校、一个学位或一段学习经历。' },
    fields: [
      field('Institution', '学校'),
      field('Department', '院系'),
      field('Major', '专业'),
      field('Degree or level', '学历或教育层次'),
      field('Start date', '入学日期', 'date'),
      field('Graduation or expected date', '毕业或预计毕业日期', 'date'),
      field('Country and city', '国家及城市'),
      field('Student ID', '学号', 'text', true),
      field('Program duration', '学制'),
      field('GPA', '绩点'),
      field('Ranking', '成绩排名'),
      field('Research area', '研究方向'),
      field('Laboratory', '实验室'),
      field('Supervisor', '导师'),
      field('Referee', '证明人'),
      field('Diploma number', '毕业证编号', 'text', true),
      field('Degree certificate number', '学位证编号', 'text', true),
      field('Student leadership', '学生干部经历'),
    ],
  },
  {
    id: 'experience',
    category: 'experience',
    name: { en: 'Work or internship', zh: '工作或实习' },
    description: { en: 'A role, responsibilities and achievements.', zh: '任职、职责和工作成果。' },
    fields: [
      field('Organization', '单位'),
      field('Department', '部门'),
      field('Role', '职位'),
      field('Employment type', '任职类型'),
      field('Start date', '开始日期', 'date'),
      field('End date', '结束日期', 'date'),
      field('Location', '地点'),
      field('Responsibilities', '职责描述', 'multiline'),
      field('Achievements', '工作业绩', 'multiline'),
    ],
  },
  {
    id: 'project',
    category: 'research',
    name: { en: 'Project', zh: '项目经历' },
    description: { en: 'Research, academic or personal projects.', zh: '科研、学术或个人项目。' },
    fields: [
      field('Project name', '项目名称'),
      field('Organization', '所属单位'),
      field('Role', '角色'),
      field('Start date', '开始日期', 'date'),
      field('End date', '结束日期', 'date'),
      field('Description', '项目简介', 'multiline'),
      field('Contributions', '个人贡献', 'multiline'),
      field('Outcomes', '项目成果', 'multiline'),
      field('Project link', '项目链接', 'url'),
    ],
  },
  {
    id: 'publication',
    category: 'research',
    name: { en: 'Publication', zh: '发表论文' },
    description: { en: 'Paper details, authors and publication links.', zh: '论文详情、作者和发表链接。' },
    fields: [
      field('Paper title', '论文标题'),
      field('Authors', '作者'),
      field('Publication date', '发表日期', 'date'),
      field('Journal or conference', '期刊或会议'),
      field('Publication status', '发表状态'),
      field('DOI or link', 'DOI 或链接', 'url'),
      field('Details', '论文详情', 'multiline'),
    ],
  },
  {
    id: 'award',
    category: 'awards',
    name: { en: 'Award or scholarship', zh: '荣誉或奖学金' },
    description: { en: 'Honors, competitions and scholarships.', zh: '荣誉、竞赛和奖学金。' },
    fields: [
      field('Award name', '荣誉名称'),
      field('Issuer', '颁发单位'),
      field('Award date', '获奖日期', 'date'),
      field('Level', '级别'),
      field('Ranking or grade', '名次或等级'),
      field('Description', '获奖说明', 'multiline'),
    ],
  },
  {
    id: 'language',
    category: 'skills',
    name: { en: 'Language or certificate', zh: '语言或证书' },
    description: { en: 'Proficiency, qualifications and test scores.', zh: '熟练程度、资质和考试成绩。' },
    fields: [
      field('Language or skill', '语言或技能'),
      field('Proficiency', '熟练程度'),
      field('Certificate', '证书名称'),
      field('Score or grade', '成绩或等级'),
      field('Issuer', '颁发单位'),
      field('Issue date', '颁发日期', 'date'),
      field('Expiry date', '有效期至', 'date'),
      field('Certificate number', '证书编号', 'text', true),
    ],
  },
  {
    id: 'family',
    category: 'contacts',
    name: { en: 'Family or emergency contact', zh: '家属或紧急联系人' },
    description: { en: 'A relative, emergency contact or referee.', zh: '家属、紧急联系人或证明人。' },
    fields: [
      field('Name', '姓名'),
      field('Relationship', '关系'),
      field('Phone', '联系电话', 'phone', true),
      field('Email', '电子邮箱', 'email', true),
      field('Emergency contact', '是否紧急联系人'),
      field('Date of birth', '出生日期', 'date', true),
      field('ID number', '证件号码', 'text', true),
      field('Employer', '工作单位'),
      field('Position', '职务'),
      field('Industry', '所属行业'),
      field('Industry specialty', '行业细分领域'),
      field('Political affiliation', '政治面貌', 'text', true),
      field('Address', '地址', 'multiline', true),
    ],
  },
  {
    id: 'document',
    category: 'documents',
    name: { en: 'Document', zh: '文件资料' },
    description: { en: 'Resumes, IDs, photos, transcripts and proofs.', zh: '简历、证件、照片、成绩单和证明。' },
    fields: [
      field('Document title', '文件标题'),
      field('Document type', '文件类型'),
      field('Issuer', '签发单位'),
      field('Document date', '文件日期', 'date'),
      field('Expiry date', '有效期至', 'date'),
      field('Variant', '版本或用途'),
      field('Description', '文件说明', 'multiline'),
    ],
  },
  {
    id: 'custom',
    category: 'custom',
    name: { en: 'Custom record', zh: '自定义记录' },
    description: { en: 'Start with your own fields.', zh: '添加所需字段。' },
    fields: [],
  },
];

export function createRecord(templateId: string, locale: Locale): ProfileRecord {
  const template = templates.find((item) => item.id === templateId);
  if (!template) throw new Error(`Unknown template: ${templateId}`);
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    category: template.category,
    title: template.name[locale],
    subtitle: '',
    tags: [],
    favorite: false,
    fields: template.fields.map((item) => ({ ...item, id: crypto.randomUUID(), value: '' })),
    notes: '',
    createdAt: now,
    updatedAt: now,
  };
}
