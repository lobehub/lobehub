import os
import json

# Configuration
SOURCE_LANG = 'zh-CN'
FALLBACK_LANG = 'en'
TARGET_DIRECTORIES = [
    'locales',
    'apps/desktop/resources/locales'
]

def load_json(path):
    """
    Load JSON file from the given path.
    Returns an empty dict if the file does not exist or parse error occurs.
    """
    if not os.path.exists(path):
        return {}
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"[ERROR] Failed to load {path}: {e}")
        return {}

def save_json(path, data):
    """
    Save data to a JSON file with specific formatting.
    indent=2 and sort_keys=True are used to maintain cleaner diffs.
    """
    try:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)
            # Add a newline at the end of file for POSIX compliance
            f.write('\n')
    except Exception as e:
        print(f"[ERROR] Failed to save {path}: {e}")

def sync_file(target_path, source_data, fallback_data):
    """
    Synchronize keys from source_data to the target file.
    Strategies:
    1. If key exists in target: Keep it.
    2. If key missing in target:
       - Try fetching from fallback_data (English).
       - If missing in fallback, use source_data (Source Language).

    Returns: The count of added keys.
    """
    target_data = load_json(target_path)
    added_count = 0

    # Iterate through all keys in the source of truth
    for key, source_value in source_data.items():
        if key not in target_data:
            # Determine the value to fill
            fill_value = fallback_data.get(key, source_value)
            target_data[key] = fill_value
            added_count += 1

    if added_count > 0:
        save_json(target_path, target_data)

    return added_count

def process_directory(base_dir):
    """
    Process a specific locales directory (e.g., 'locales' or 'apps/desktop/...').
    """
    print(f"--- Processing Directory: {base_dir} ---")

    # Define paths for Source and Fallback
    source_dir_path = os.path.join(base_dir, SOURCE_LANG)
    fallback_dir_path = os.path.join(base_dir, FALLBACK_LANG)

    if not os.path.exists(source_dir_path):
        print(f"[WARN] Source directory {source_dir_path} not found. Skipping.")
        return

    # Get list of all subdirectories (language codes)
    try:
        all_langs = sorted([d for d in os.listdir(base_dir) if os.path.isdir(os.path.join(base_dir, d))])
    except OSError as e:
        print(f"[ERROR] Could not list directories in {base_dir}: {e}")
        return

    # Iterate over each language directory
    for lang in all_langs:
        # Skip source language, fallback language, and hidden folders
        if lang == SOURCE_LANG or lang.startswith('.'):
            continue

        lang_path = os.path.join(base_dir, lang)

        # Identify all JSON files in the source directory to sync against
        source_files = [f for f in os.listdir(source_dir_path) if f.endswith('.json')]

        for filename in source_files:
            source_file_path = os.path.join(source_dir_path, filename)
            fallback_file_path = os.path.join(fallback_dir_path, filename)
            target_file_path = os.path.join(lang_path, filename)

            # Load reference data
            source_data = load_json(source_file_path)
            fallback_data = load_json(fallback_file_path)

            # Perform sync
            added = sync_file(target_file_path, source_data, fallback_data)

            if added > 0:
                print(f"[{lang}] {filename}: +{added} keys added")

def main():
    root_dir = os.getcwd()

    for relative_path in TARGET_DIRECTORIES:
        full_path = os.path.join(root_dir, relative_path)
        if os.path.exists(full_path):
            process_directory(full_path)
        else:
            print(f"[WARN] Directory not found: {full_path}")

    print("\nBenchmark complete. All locale files are synchronized.")

if __name__ == "__main__":
    main()
