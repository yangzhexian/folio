use super::*;

pub const CATEGORY_ICONS: &[&str] = &[
    "user-round",
    "graduation-cap",
    "briefcase-business",
    "flask-conical",
    "award",
    "badge-check",
    "users",
    "file-text",
    "sliders-horizontal",
    "folder",
    "heart",
    "house",
    "car",
    "plane",
    "wallet",
    "book-open",
    "calendar",
    "globe",
    "laptop",
    "music",
    "camera",
    "star",
    "shield",
    "building",
];

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CategoryDefinition {
    pub id: String,
    pub name_en: String,
    pub name_zh: String,
    pub icon: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CategoryCatalog {
    pub categories: Vec<CategoryDefinition>,
    pub revision: String,
}

pub fn builtin_categories() -> Vec<CategoryDefinition> {
    [
        ("identity", "Identity", "个人信息", "user-round"),
        ("education", "Education", "教育经历", "graduation-cap"),
        ("experience", "Experience", "工作经历", "briefcase-business"),
        ("research", "Research", "项目与研究", "flask-conical"),
        ("awards", "Awards", "荣誉奖励", "award"),
        ("skills", "Skills", "技能证书", "badge-check"),
        ("contacts", "Contacts", "家庭与联系人", "users"),
        ("documents", "Documents", "文件资料", "file-text"),
        ("custom", "Custom", "自定义", "sliders-horizontal"),
    ]
    .into_iter()
    .map(|(id, name_en, name_zh, icon)| CategoryDefinition {
        id: id.into(),
        name_en: name_en.into(),
        name_zh: name_zh.into(),
        icon: icon.into(),
    })
    .collect()
}

pub fn builtin_catalog() -> CategoryCatalog {
    CategoryCatalog {
        categories: builtin_categories(),
        revision: "builtin-v1".into(),
    }
}

pub fn validate_category_id(id: &str) -> Result<()> {
    if CATEGORIES.contains(&id) {
        return Ok(());
    }
    id.strip_prefix("collection-")
        .ok_or_else(|| "UNKNOWN_CATEGORY".to_owned())
        .and_then(|uuid| validate_id(uuid).map_err(|_| "UNKNOWN_CATEGORY".into()))
}

pub fn normalize_categories(
    mut categories: Vec<CategoryDefinition>,
) -> Result<Vec<CategoryDefinition>> {
    if categories.len() > 100 {
        return Err("INVALID_CATEGORIES".into());
    }
    let mut ids = HashSet::new();
    let mut names_en = HashSet::new();
    let mut names_zh = HashSet::new();
    for category in &mut categories {
        category.name_en = category.name_en.trim().to_owned();
        category.name_zh = category.name_zh.trim().to_owned();
        if validate_category_id(&category.id).is_err()
            || !ids.insert(category.id.clone())
            || !CATEGORY_ICONS.contains(&category.icon.as_str())
            || [&category.name_en, &category.name_zh]
                .into_iter()
                .any(|name| {
                    name.is_empty()
                        || name.chars().count() > 60
                        || name.chars().any(char::is_control)
                })
            || !names_en.insert(category.name_en.to_lowercase())
            || !names_zh.insert(category.name_zh.to_lowercase())
        {
            return Err("INVALID_CATEGORIES".into());
        }
    }
    if CATEGORIES.iter().any(|id| !ids.contains(*id)) {
        return Err("INVALID_CATEGORIES".into());
    }
    Ok(categories)
}

pub fn require_category(categories: &[CategoryDefinition], id: &str) -> Result<()> {
    if categories.iter().any(|category| category.id == id) {
        Ok(())
    } else {
        Err("UNKNOWN_CATEGORY".into())
    }
}
