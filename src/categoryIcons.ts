import { UserRound, GraduationCap, BriefcaseBusiness, FlaskConical, Award, BadgeCheck, Users, FileText, SlidersHorizontal, Folder, Heart, House, Car, Plane, Wallet, BookOpen, Calendar, Globe, Laptop, Music, Camera, Star, Shield, Building } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Locale } from './types';
import type { categoryIconIds } from './categories';

type IconId = typeof categoryIconIds[number];
const icons: Record<IconId, LucideIcon> = { 'user-round': UserRound, 'graduation-cap': GraduationCap, 'briefcase-business': BriefcaseBusiness, 'flask-conical': FlaskConical, award: Award, 'badge-check': BadgeCheck, users: Users, 'file-text': FileText, 'sliders-horizontal': SlidersHorizontal, folder: Folder, heart: Heart, house: House, car: Car, plane: Plane, wallet: Wallet, 'book-open': BookOpen, calendar: Calendar, globe: Globe, laptop: Laptop, music: Music, camera: Camera, star: Star, shield: Shield, building: Building };
const names: Record<IconId, [string, string]> = { 'user-round': ['Person', '人物'], 'graduation-cap': ['Education', '教育'], 'briefcase-business': ['Work', '工作'], 'flask-conical': ['Research', '研究'], award: ['Award', '奖项'], 'badge-check': ['Certificate', '证书'], users: ['People', '联系人'], 'file-text': ['Document', '文档'], 'sliders-horizontal': ['Sliders', '调节'], folder: ['Folder', '文件夹'], heart: ['Heart', '爱心'], house: ['Home', '住宅'], car: ['Car', '汽车'], plane: ['Travel', '旅行'], wallet: ['Wallet', '钱包'], 'book-open': ['Book', '书籍'], calendar: ['Calendar', '日历'], globe: ['Globe', '地球'], laptop: ['Computer', '电脑'], music: ['Music', '音乐'], camera: ['Camera', '相机'], star: ['Star', '星星'], shield: ['Shield', '盾牌'], building: ['Building', '建筑'] };

export const categoryIcon = (id: string): LucideIcon => icons[id as IconId] ?? Folder;
export const categoryIconName = (id: IconId, locale: Locale) => names[id][locale === 'zh' ? 1 : 0];
