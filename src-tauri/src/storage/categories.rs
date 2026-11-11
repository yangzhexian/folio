use super::*;

impl Store {
    /// Read the catalog without initializing or migrating the library.
    pub fn agent_categories(&self) -> Result<CategoryCatalog> {
        let db = Connection::open_with_flags(
            self.vault().join("folio.sqlite3"),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .map_err(err)?;
        db.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(err)?;
        read_category_catalog(&db)
    }

    /// Callers hold the shared operation lock for the entire operation.
    pub fn save_categories(
        &self,
        categories: Vec<CategoryDefinition>,
        expected_revision: &str,
    ) -> Result<CategoryCatalog> {
        let categories = normalize_categories(categories)?;
        let mut db = self.connection()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let previous = read_category_catalog(&tx)?;
        if previous.revision != expected_revision {
            return Err("CATEGORY_CONFLICT".into());
        }
        if previous
            .categories
            .iter()
            .any(|old| !categories.iter().any(|new| new.id == old.id))
        {
            return Err("INVALID_CATEGORIES".into());
        }
        let catalog = CategoryCatalog {
            categories,
            revision: Uuid::new_v4().to_string(),
        };
        write_category_catalog(&tx, &catalog)?;
        tx.commit().map_err(err)?;
        Ok(catalog)
    }
}

pub(super) fn read_category_catalog(db: &Connection) -> Result<CategoryCatalog> {
    let exists: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='category_catalog')",
        [], |row| row.get(0),
    ).map_err(err)?;
    if !exists {
        return Ok(builtin_catalog());
    }
    let body: Option<String> = db
        .query_row("SELECT body FROM category_catalog WHERE id=1", [], |row| {
            row.get(0)
        })
        .optional()
        .map_err(err)?;
    let Some(body) = body else {
        return Ok(builtin_catalog());
    };
    let catalog: CategoryCatalog = serde_json::from_str(&body).map_err(err)?;
    let normalized = normalize_categories(catalog.categories.clone())?;
    if normalized != catalog.categories || validate_id(&catalog.revision).is_err() {
        return Err("INVALID_CATEGORIES".into());
    }
    Ok(catalog)
}

pub(super) fn write_category_catalog(db: &Connection, catalog: &CategoryCatalog) -> Result<()> {
    db.execute(
        "INSERT INTO category_catalog(id,body) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
        [serde_json::to_string(catalog).map_err(err)?],
    ).map_err(err)?;
    Ok(())
}

pub(super) fn require_registered_category(db: &Connection, category: &str) -> Result<()> {
    require_category(&read_category_catalog(db)?.categories, category)
}

#[cfg(test)]
mod tests;
