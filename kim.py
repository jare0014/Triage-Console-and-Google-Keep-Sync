__version__ = "0.6.8"

import os
import gkeepapi
import keyring
import getpass
import requests
import shutil
import re
import configparser
import click
import datetime
import operator
import logging
import tempfile
from os.path import join
from pathlib import Path
from dataclasses import dataclass, astuple
from xmlrpc.client import boolean
from importlib.metadata import version
from PIL import Image
from pathlib import Path

KEEP_KEYRING_ID = 'google-keep-token'
KEEP_NOTE_URL = "https://keep.google.com/#NOTE/"
CONFIG_FILE = "settings.cfg"
DEFAULT_SECTION = "SETTINGS"
USERID_EMPTY = 'add your google account name here'
OUTPUTPATH = 'mdfiles'
MEDIADEFAULTPATH = "media"
INPUTDEFAULTPATH = "import"
INPUTDEFAULTCOMPLETE = "completed"
DEFAULT_LABELS = "my_label"
DEFAULT_SEPARATOR = "/"
MAX_FILENAME_LENGTH = 99
MISSING = 'null value'
NOTE_PREFIX = "#NOTE/"
KEEP_URL = "https://keep.google.com/u/0/#NOTE/"
LOG_FILE = "kim.log"
TECH_ERR = " Technical Error Message: "

CONFIG_FILE_MESSAGE = ("Your " + CONFIG_FILE + " file contains to the following [" 
                        + DEFAULT_SECTION + "] values. Be sure to edit it with "
                        " your information.")
MALFORMED_CONFIG_FILE = ("The " + CONFIG_FILE + " default settings file exists but "
                        "has a malformed header - header should be [" + DEFAULT_SECTION + "]")
UNKNOWNN_CONFIG_FILE = ("There is an unknown configuration file issue - " 
                        + CONFIG_FILE + " or file system may be locked or "
                        "corrupted. Try deleting the file and recreating it.")
MISSING_CONFIG_FILE = ("The configuration file - " + CONFIG_FILE + " is missing. "
                        "Please check the documention on recreating it")
BADFILE_CONFIG_FILE = ("Unable to create " + CONFIG_FILE + ". "
                        "The file system issue such as locked or corrupted")
KEYERR_CONFIG_FILE = ("Configuration key in " + CONFIG_FILE + " not found. "
                        "Key passed is: ")

ILLEGAL_FILE_CHARS = ['<', '>', ':', '"', '\\', '|', '?', '*', '&', '\n', '\r', '\t']
ILLEGAL_TAG_CHARS = ['~', '`', '!', '@', '$', '%', '^', '(', ')', '+', '=', '{', '}', '[', \
        ']', '<', '>', ';', ':', ',', '.', '"', '/', '\\', '|', '?', '*', '&', '\n', '\r']

default_settings = {
    'google_userid': USERID_EMPTY,
    'output_path': OUTPUTPATH,
    'media_path': MEDIADEFAULTPATH,
    'input_path': INPUTDEFAULTPATH,
    'input_labels': DEFAULT_LABELS,
    'folder_separator': DEFAULT_SEPARATOR
}

notes = []

logging.basicConfig(filename=LOG_FILE,
                    format='%(message)s',
                    filemode='a')

# --- Silence harmless gkeepapi warnings ---
logging.getLogger('gkeepapi').setLevel(logging.ERROR)

@dataclass
class Options:
    reset: boolean
    overwrite: boolean
    archive_only: boolean
    preserve_labels: boolean
    skip_existing: boolean 
    text_for_title: boolean
    logseq_style: boolean
    joplin_frontmatter: boolean
    move_to_archive: boolean
    wikilinks: boolean
    delete_labels: boolean
    silent_mode: boolean
    import_files: boolean
    import_labels: str
    create_date: str
    edit_date: str

@dataclass
class Note:
    id: str
    title: str
    text: str
    archived: boolean
    trashed: boolean
    timestamps: dict
    created: datetime.datetime
    edited: datetime.datetime
    labels: list
    blobs: list
    blob_names: list
    media: list
    header: str

class ConfigurationException(Exception):
    def __init__(self, msg):
        self.msg = msg
    def __str__(self):
        return self.msg

class Config:
    _config = configparser.ConfigParser()
    _configdict = {}

    def __new__(cls):
        if not hasattr(cls, 'instance'):
            cls.instance = super(Config, cls).__new__(cls)
            cls.instance.__read()
            cls.instance.__load()
        return cls.instance

    def __read(self):
        try:
            self._cfile = self._config.read(CONFIG_FILE)
            if not self._cfile:
                self.__create()
        except configparser.MissingSectionHeaderError:
            raise ConfigurationException(MALFORMED_CONFIG_FILE)
        except Exception:
            raise ConfigurationException(UNKNOWNN_CONFIG_FILE)
    
    def __create(self):
        self._config[DEFAULT_SECTION] = default_settings
        try:
            with open(CONFIG_FILE, 'w') as configfile:
                self._config.write(configfile)
        except Exception as e:
            raise ConfigurationException(BADFILE_CONFIG_FILE)

    def __load(self):
        options = self._config.options(DEFAULT_SECTION)
        for option in options:
            self._configdict[option] = \
                self._config.get(DEFAULT_SECTION, option)

    def get(self, key):
        import os
        env_key = f"KIM_{key.upper()}"
        if env_key in os.environ:
            return os.environ[env_key]

        # Fallback to loading directly from the plugin's data.json setting file
        data_json_path = os.path.join(os.path.dirname(__file__), 'data.json')
        if os.path.exists(data_json_path):
            try:
                import json
                with open(data_json_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                mapping = {
                    'google_userid': 'googleUserid',
                    'output_path': 'outputPath',
                    'media_path': 'mediaPath',
                    'input_path': 'inputPath',
                    'input_labels': 'inputLabels',
                    'folder_separator': 'folderSeparator',
                    'exclude_titles': 'excludeTitles',
                    'quicklog_title': 'quicklogTitle',
                    'log_header': 'logHeader'
                }
                
                json_key = mapping.get(key)
                if json_key and json_key in data:
                    val = data[json_key]
                    if val is not None:
                        return str(val)
            except Exception:
                pass

        try:
            return(self._configdict[key])
        except Exception as e:
            raise ConfigurationException(KEYERR_CONFIG_FILE + key)

class Markdown:
    @staticmethod
    def convert_urls(text):
        urls = re.findall(
            r"http[s]?://(?:[a-zA-Z]|[0-9]|[~#$-_@.&+]"
                "|[!*\\(\\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+",
            text
        )
        mdurls = re.findall(r"\[([^\]]+)\]\(([^)]+)\)", text)
        for url in urls:
            convert = True
            for murl in mdurls:
                if url[:-1] in murl[1]:
                    convert = False 
            if convert:
                text = text.replace(url, 
                    "[" + url[:1] + "%%%" + url[2:] + 
                    "](" + url[:1] + "%%%" + url[2:] + ")", 1)
        return text.replace("h%%%tp", "http")

    @staticmethod
    def format_checkboxes(text):
        md_text = text.replace(u"\u2610", '- [ ]') \
            .replace(u"\u2611", ' - [x]')
        return md_text

    @staticmethod
    def format_title(title):
        title = re.sub(
            '[' + re.escape(''.join(ILLEGAL_FILE_CHARS)) + ']', 
            ' ', 
            title[0:MAX_FILENAME_LENGTH]
        ) 
        return title

    @staticmethod
    def format_check_boxes(text):
        return(text.replace(u"\u2610", '- [ ]').replace(u"\u2611", ' - [x]'))

    @staticmethod
    def format_path(path, name, media, replacement):
        if media:
            header = "!["
        else:
            header = "["
        path = path.replace(" ", replacement)
        if name:
            return (header + name + "](" + path + ")")
        else:
            return (header + path + "](" + path + ")")

class SecureStorage:
    def __init__(self, userid, keyring_reset, master_token):
        self._userid = userid
        if keyring_reset:
            self._clear_keyring()
        if master_token:
            try:
                self.set_keyring(master_token)
            except:
                pass

    def get_keyring(self):
        try:
            self._keep_token = keyring.get_password(
                KEEP_KEYRING_ID, self._userid)
        except Exception:
            self._keep_token = None
        return self._keep_token

    def set_keyring(self, keeptoken):
        try:
            keyring.set_password(
                KEEP_KEYRING_ID, self._userid, keeptoken)
        except Exception:
            pass

    def _clear_keyring(self):
        try:
            keyring.delete_password(
                KEEP_KEYRING_ID, self._userid)
        except:
            return None
        else:
            return True

class KeepService:
    def __init__(self, userid):
        self._keepapi = gkeepapi.Keep()
        self._userid = userid

    def get_ref(self):
        return(self._keepapi)

    def keep_sync(self):
        self._keepapi.sync()

    def set_token(self, keyring_reset, master_token):
        self._securestorage = SecureStorage(
            self._userid, keyring_reset, master_token)
        if master_token:
            self._keep_token = master_token
        else:
            self._keep_token = self._securestorage.get_keyring()
        return self._keep_token

    def set_user(self, userid):
        self._userid = userid

    def login(self, pw, keyring_reset):
        try:
            self._keepapi.login(self._userid, pw)
        except:
            return None
        else:
            self._keep_token = self._keepapi.getMasterToken()
            if keyring_reset == False:
                self._securestorage.set_keyring(self._keep_token)
            return self._keep_token

    def resume(self):
        kv = version('gkeepapi')
        if kv < "0.16.0":
            self._keepapi.resume(self._userid, self._keep_token)
        else:
            self._keepapi.authenticate(self._userid, self._keep_token)

    def getnote(self, id):
        return(self._keepapi.get(id))
    
    def getnotes(self):
        return(self._keepapi.all())

    def findnotes(self, kquery, labels, archive_only):
        if labels:
            return(self._keepapi.find(labels=[self._keepapi.findLabel(kquery[1:])], 
                archived=archive_only, trashed=False))
        else:
            return(self._keepapi.find(query=kquery, 
                archived=archive_only, trashed=False))

    def createnote(self, title, notetext):
        self._note = self._keepapi.createNote(title, notetext)
        return(None)
    
    def appendnotes(self, kquery, append_text):
        gnotes = self.findnotes(kquery, False, False)
        for gnote in gnotes:
            gnote.text += "\n\n" + append_text
        self.keep_sync()
        return(None)

    def setnotelabel(self, label):
        try:
            self._labelid = self._keepapi.findLabel(label)
            self._note.labels.add(self._labelid)
        except Exception as e:
            raise ValueError("Label doesn't exist! - label: " +  label + "  Use pre-defined labels when importing")

    def getmedia(self, blob):
        try:
            link = self._keepapi.getMediaLink(blob)
            return(link)
        except Exception as e:
            return(None)

class NameService:
    def __new__(cls):
        if not hasattr(cls, 'instance'):
            cls.instance = super(NameService, cls).__new__(cls)
            cls.instance._namelist = []
        return cls.instance

    def clear_name_list(self):
        self._namelist.clear()

    def check_duplicate_name(self, note_title, note_date):
        if note_title in self._namelist:
            note_title = note_title + note_date
            note_title = self.check_duplicate_name(note_title, note_date)
        self._namelist.append(note_title)
        return (note_title)

    def check_file_exists(self, md_file, outpath, note_title, note_date):
        self._namelist.remove(note_title)
        while md_file.exists():
            note_title = self.check_duplicate_name(note_title, note_date)
            self._namelist.append(note_title)
            md_file = Path(outpath, note_title + ".md")
        return (note_title)

class FileService:
    @staticmethod
    def log(text, silent_mode):
        if silent_mode:
            logger = logging.getLogger()
            logger.setLevel(logging.INFO)
            logger.info(text)
        else:
            try:
                click.echo(text)
            except UnicodeEncodeError:
                # Catch emojis and special characters that crash the Windows terminal
                safe_text = text.encode('ascii', errors='replace').decode('ascii')
                click.echo(safe_text)

    @staticmethod
    def resolve_path(path_str):
        if not path_str:
            return path_str
        path = Path(path_str)
        if path.is_absolute():
            return str(path)
        
        # If relative, resolve it against the vault root (3 levels up from this script)
        script_dir = Path(__file__).resolve().parent
        try:
            parts = script_dir.parts
            if ".obsidian" in parts:
                obsidian_idx = parts.index(".obsidian")
                vault_root = Path(parts[0])
                for part in parts[1:obsidian_idx]:
                    vault_root = vault_root / part
                return str(vault_root / path)
        except Exception:
            pass
        return str(Path(os.getcwd()) / path)

    def media_path (self):
        outpath = self.outpath()
        media = Config().get("media_path").rstrip("/")
        mediapath = os.path.join(outpath, media) + "/"
        return(mediapath)

    def outpath (self):
        outpath = Config().get("output_path").rstrip("/")
        if outpath == "mdfiles":
            return str(Path(__file__).resolve().parent / outpath)
        return self.resolve_path(outpath)

    def inpath (self):
        inpath = Config().get("input_path").rstrip("/")
        return str(Path(__file__).resolve().parent / inpath) + "/"

    def create_path(self, path):
        if not os.path.exists(path):
            os.makedirs(path)

    def write_file(self, file_name, data):
        try:
            f = open(file_name, "w+", encoding='utf-8', errors="ignore")
            f.write(data)
            f.close
        except Exception as e:
            raise Exception("Error in write_file: " + " -- " + TECH_ERR + repr(e))

    def download_file(self, file_url, file_name, file_path):
        try:
            temp_dir = tempfile.gettempdir()
            data_file = os.path.join(temp_dir, file_name) 
            
            r = requests.get(file_url)
            if r.status_code == 200:
                with open(data_file, 'wb') as f:
                    f.write(r.content)
                return (data_file)
            else:
                blob_final_path = "Media could not be retrieved"
                return ("")
        except Exception as e:
            raise RuntimeError(f"Error in download_file(): {str(e)}")

    def set_file_extensions(self, data_file, file_name, file_path):
        dest_path = file_path + file_name
        try:
            image = Image.open(data_file)
            what = image.format.lower()
            image.close()
        except:
            what = ".audio"

        if what == 'png':
            media_name = file_name + ".png"
            blob_final_path = dest_path + ".png"
        elif what == 'jpeg':
            media_name = file_name + ".jpg"
            blob_final_path = dest_path + ".jpg"
        elif what == 'gif':
            media_name = file_name + ".gif"
            blob_final_path = dest_path + ".gif"
        elif what == 'webp':
            media_name = file_name + ".webp"
            blob_final_path = dest_path + ".webp"
        else:
            with open(data_file, 'rb') as file:
                val = file.read(8).hex()
            if val == "0000001c66747970":
                extension = ".m4a"
            else:
                extension = ".mp3"
            media_name = file_name + extension
            blob_final_path = dest_path + extension

        shutil.copyfile(data_file, blob_final_path)

        if os.path.exists(data_file):
            os.remove(data_file)
        return (media_name)

def replace_wikilinks(text):
    pattern = r"\[\[([^\]]*)\]\]"
    def replace(match):
        link_text = match.group(1)
        parts = link_text.split("|")
        file_link = parts[0].replace(' ', '%20')
        if len(parts) == 1:
            return f"[{parts[0]}]({file_link}.md)"
        else:
            return f"[{parts[1]}]({file_link}.md)"
    return re.sub(pattern, replace, text, count=0, flags=re.MULTILINE)

def replace_func(match):
    link_text, url = match.groups()
    if "keep.google.com" in url:
      return f"[[{link_text}]]"
    else:
      return match.group(0)
    
def add_wikilinks(text):
    pattern = r"\[([^\]]+)\]\(([^)]+)\)"
    return re.sub(pattern, replace_func, text)

def save_md_file(note, note_tags, note_date, opts):
    try:
        fs = FileService()
        md_text = Markdown().format_check_boxes(note.text)
        note.title = NameService().check_duplicate_name(note.title, note_date)

        for media in note.media:
            md_text = Markdown().format_path(Config().get("media_path") + 
                "/" + media, "", True, "_") + "\n" + md_text

        md_file = Path(fs.outpath(), note.title + ".md")
        if not opts.overwrite:
            if md_file.exists():
                if opts.skip_existing:
                    return (0)
                else:
                    note.title = NameService().check_file_exists(
                            md_file, fs.outpath(), note.title, note_date)
                    md_file = Path(fs.outpath(), note.title + ".md")

        fs.log(note.title, opts.silent_mode)
        fs.log(note_tags, opts.silent_mode)
        fs.log(note_date + "\r\n", opts.silent_mode)

        if not (note.timestamps):
            timestamps = ""
        else:
            timestamps = ("Created: " + note.timestamps["created"]
                        [ : note.timestamps["created"].rfind('.') ] + "   ---   " + 
                        "Updated: " + note.timestamps["edited"]
                        [ : note.timestamps["edited"].rfind('.') ] + "\n\n")

        markdown_data = (
            note.header + 
            Markdown().convert_urls(md_text) + "\n" + 
            "\n" + note_tags + "\n\n" + 
            timestamps + 
            Markdown().format_path(KEEP_NOTE_URL + str(note.id), 
                                   "", False, "%20") + "\n\n")

        fs.write_file(md_file, markdown_data)
        return (1)
    except Exception as e:
        raise Exception("Problem with markdown file creation: " + 
                        str(md_file) + " -- " + TECH_ERR + repr(e))

def keep_import_notes(keep, opts):
    try:
        dir_path = FileService().inpath()
        labels = Config().get("input_labels").split(",")
        if len(opts.import_labels) > 0:
            labels = opts.import_labels.split(",")
        in_labels = [item.strip() for item in labels]
        for file in os.listdir(dir_path):
            if os.path.isfile(dir_path + file) and (file.endswith('.md') or file.endswith('.txt')):
                with open(dir_path + file, 'r', encoding="utf8") as md_file:
                    mod_time = datetime.datetime.fromtimestamp(
                        os.path.getmtime(dir_path + file)).strftime('%Y-%m-%d %H:%M:%S')
                    crt_time = datetime.datetime.fromtimestamp(
                        os.path.getctime(dir_path + file)).strftime('%Y-%m-%d %H:%M:%S')
                    data=md_file.read()
                    data += "\n\nCreated: " + crt_time + "   -   Updated: " + mod_time
                    title = file.replace('.md', '').replace('.txt', '')
                    FileService.log("Importing note: '" + title + "' from " + file, opts.silent_mode)
                    keep.createnote(title, data)
                    for in_label in in_labels:
                        keep.setnotelabel(in_label.strip())
                    keep.keep_sync()
                    os.rename(dir_path + file, dir_path + INPUTDEFAULTCOMPLETE + "/" + file)
    except Exception as e:
        raise RuntimeError('Note import:', str(e))

def keep_get_blobs(keep, note):
    fs = FileService()
    for idx, blob in enumerate(note.blobs):
        note.blob_names[idx] = note.title.replace(" ", "_") + str(idx)
        if blob != None:
            url = keep.getmedia(blob)
            blob_file = None
            if url:
                blob_file = fs.download_file(url, note.blob_names[idx] + ".dat", fs.media_path()) 
                if blob_file:
                    data_file = fs.set_file_extensions(blob_file, note.blob_names[idx], fs.media_path())
                    note.media.append(data_file)
                else:
                    print ("Download of Keep media failed...")

def process_quicklog(keep, note_id):
        gnote = keep.getnote(note_id)
        if not gnote: 
            return

        entries = []
        if hasattr(gnote, 'items'):
            for item in gnote.items:
                if not item.checked:
                    entries.append(f"- {item.text.strip()}")
                    item.delete()
        else:
            lines = gnote.text.split('\n')
            for line in lines:
                if line.strip():
                    entries.append(f"- {line.strip()}")
            gnote.text = "" 

        if not entries: 
            return 

        import os
        env_daily_note = os.environ.get("KIM_DAILY_NOTE_PATH")
        if env_daily_note:
            daily_note_path = Path(env_daily_note)
        else:
            today_str = datetime.datetime.now().strftime("%Y-%m-%d")
            daily_note_dir = Path.home() / "Documents" / "Obsidian" / "02_Journal" / "01_Daily"
            daily_note_path = daily_note_dir / f"{today_str}.md"
        
        if daily_note_path.exists():
            # Read current content
            with open(daily_note_path, 'r', encoding='utf-8') as f:
                content = f.read()
                
            lines = content.splitlines()
            try:
                target_header = Config().get("log_header")
            except Exception:
                target_header = os.environ.get("KIM_LOG_HEADER") or "## 🪵 Log"
            
            # Find the header
            header_idx = -1
            for idx, line in enumerate(lines):
                if target_header in line:
                    header_idx = idx
                    break
                    
            if header_idx != -1:
                # Find the end of that section (either next header or end of file)
                insert_idx = header_idx + 1
                while insert_idx < len(lines):
                    if lines[insert_idx].startswith("##") or lines[insert_idx].startswith("# "):
                        break
                    insert_idx += 1
                # Insert entries at the end of the section
                for entry in reversed(entries):
                    lines.insert(insert_idx, entry)
                new_content = "\n".join(lines) + "\n"
            else:
                # Fallback: append at the bottom
                new_content = content.rstrip() + "\n\n" + "\n".join(entries) + "\n"
                
            with open(daily_note_path, 'w', encoding='utf-8') as f:
                f.write(new_content)
                    
            keep.keep_sync() 
            print(f"✅ SUCCESS: Appended {len(entries)} items to: {daily_note_path.resolve()}")
        else:
            print(f"Error: Daily note {daily_note_path} not found. Cannot append Quicklog.")

def keep_query_convert(keep, keepquery, opts):
    comparison_operators = {
    "<": operator.lt,
    ">": operator.gt
    }
    try:
        count = 0
        ccnt = 0

        if keepquery == "--all":
            gnotes = keep.getnotes()
        else:
            if keepquery[0] == "#":
                gnotes = keep.findnotes(keepquery, True, opts.archive_only)
            else:
                gnotes = keep.findnotes(keepquery, False, opts.archive_only)
               
        notes = []

        for gnote in gnotes:
            notes.append(
                Note(
                    gnote.id, 
                    gnote.title, 
                    gnote.text, 
                    gnote.archived,
                    gnote.trashed,
                    {"created": str(gnote.timestamps.created), 
                        "edited": str(gnote.timestamps.edited)},
                    gnote.timestamps.created,
                    gnote.timestamps.edited,
                    [str(label) for label in gnote.labels.all()],
                    [blob for blob in gnote.blobs],
                    ['' for blob in gnote.blobs], 
                    [],
                    ""
                   )
            )

        filter_date = opts.create_date or opts.edit_date or None
        coperator = ""
        compare_date = None
        if (filter_date):
            coperator = filter_date[:1]
            compare_date = datetime.datetime.strptime(
                re.split('<|>', filter_date)[1].strip() 
                    + "T00:00:00+0000", "%Y-%m-%dT%H:%M:%S%z")

        # Load excluded and quicklog titles
        import os
        env_excluded = os.environ.get("KIM_EXCLUDE_TITLES")
        if not env_excluded:
            try:
                env_excluded = Config().get("exclude_titles")
            except Exception:
                pass
        if env_excluded:
            excluded_titles = [t.strip() for t in env_excluded.split(",")]
        else:
            excluded_titles = ["Shopping", "Wishlist"]
            
        env_quicklog = os.environ.get("KIM_QUICKLOG_TITLE")
        if not env_quicklog:
            try:
                env_quicklog = Config().get("quicklog_title")
            except Exception:
                pass
        if not env_quicklog:
            env_quicklog = "Quicklog"

        for note in notes:
            title_stripped = note.title.strip() if note.title else ""
            if title_stripped in excluded_titles or title_stripped == env_quicklog:
                if title_stripped == env_quicklog:
                    print(f"Processing specialized Quicklog note...")
                    process_quicklog(keep, note.id)
                else:
                    print(f"Skipping excluded note: {note.title}")
                continue
         
            if compare_date:
                op = comparison_operators.get(coperator, None)
                if opts.create_date and not op(note.created, compare_date):
                    continue
                if opts.edit_date and not op(note.edited, compare_date):
                    continue

            note_date = re.sub('[^A-z0-9-]', ' ', note.timestamps["created"].replace(":", "").replace(".", "-"))

            # Strict Fallback Cascade
            if note.title and note.title.strip():
                raw_name = note.title.strip()
            elif note.text and note.text.strip():
                raw_name = note.text.strip().replace('\n', ' ')[:30]
            else:
                raw_name = "Untitled Note"

            note.title = re.sub('[' + re.escape(''.join(ILLEGAL_FILE_CHARS)) + ']', ' ', raw_name)
            note.title = note.title.strip()[0:99] 

            if opts.wikilinks:
                note.text = add_wikilinks(note.text)

            if opts.logseq_style:
                note.title = note.title.replace("/", "___")
                c = note.text[:1]
                if c == u"\u2610" or c == u"\u2611":
                    note.text.replace("\n\n", "\n- ")
                else:
                    note.text = "- " + note.text.replace("\n\n", "\n- ")

            labels = note.labels
            note_labels = ""
            if opts.preserve_labels:
                for label in labels:
                    note_labels = note_labels + " #" + str(label)
            else:
                for label in labels:
                    note_labels = note_labels + " #" + str(label).replace(' ', '-').replace('&', 'and')
                note_labels = re.sub('[' + re.escape(''.join(ILLEGAL_TAG_CHARS)) + 
                                     ']', '-', note_labels)  

            if opts.joplin_frontmatter:
                joplin_labels = ""
                jls = [item.strip() for item in note_labels.split("#")]
                jls = list(filter(None, jls))
                for label in jls:
                    jlabel = "  - " + label + "\n"
                    if jlabel not in joplin_labels:
                        joplin_labels += jlabel
                note.header = ("---\ntitle: " + note.title + 
                            "\nupdated: " + note.timestamps["edited"] + 
                            "Z\ncreated: " + note.timestamps["created"] + 
                            "Z\ntags:\n" + joplin_labels + 
                            "---\n\n")
                note.title = note.title.replace("/", "_")
                note_labels = ""
                note.timestamps = {}
                note.text = replace_wikilinks(note.text)
                
            note.title = note.title.replace("/", "")
            note.text = note.text.replace("(" + NOTE_PREFIX,"(" + KEEP_URL)
            
            if opts.delete_labels:
                for label in note_labels.split():
                    pattern = rf"{re.escape(label)}"
                    if re.search(pattern, note.text):
                        note_labels = note_labels.replace(label, "")
                note_labels = note_labels.lstrip()

            # --- SECURE ARCHIVING SEQUENCE ---
            if opts.archive_only:
                if note.archived and note.trashed == False:
                    keep_get_blobs(keep, note)
                    ccnt = save_md_file(note, note_labels, note_date, opts)
                    if ccnt > 0 and opts.move_to_archive:
                        keep.getnote(note.id).archived = True
                else:
                    ccnt = 0
            else:
                if note.archived == False and note.trashed == False:
                    keep_get_blobs(keep, note)
                    ccnt = save_md_file(note, note_labels, note_date, opts)
                    if ccnt > 0 and opts.move_to_archive:
                        keep.getnote(note.id).archived = True
                else:
                    ccnt = 0

            count = count + ccnt

        if opts.overwrite or opts.skip_existing:
            NameService().clear_name_list()

        if opts.move_to_archive:
            keep.keep_sync()

        return (count)
    except Exception as e:
        raise RuntimeError(f"Error in keep_query_convert(): {str(e)}")

def ui_login(master_token, opts):
    try:
        intro = "\r\nWelcome to Keep it Markdown or KIM " + __version__ + "!\r\n"
        if opts.silent_mode:
            now = datetime.datetime.now()
            intro = "\r\n------\r\n" + now.strftime("%Y-%m-%d %H:%M:%S") + intro + "\r\n"

        fs = FileService()
        fs.log(intro, opts.silent_mode)

        userid = Config().get("google_userid").strip().lower()

        if not userid or userid == USERID_EMPTY:
            import sys
            if not sys.stdin.isatty():
                raise ValueError("No Google username configured in settings.cfg or environment, and stdin is non-interactive.")
            userid = click.prompt('Enter your Google account username', type=str)
        else:
            fs.log("Your Google account name in the " 
                            + CONFIG_FILE + " file is: " + userid + " -- Welcome!", opts.silent_mode)

        keep = KeepService(userid)
        ktoken = keep.set_token(opts.reset, master_token)

        if ktoken == None:
            import sys
            if not sys.stdin.isatty():
                raise ValueError("No Google Keep Master Token found in environment or keyring, and stdin is non-interactive. Please enter it in the plugin settings.")
            pw = getpass.getpass(prompt='Enter your Google Password: ', stream=None)
            print("\r\n\r\nOne moment...")

            ktoken = keep.login(pw, opts.reset)
            if ktoken:
                if opts.reset:
                    fs.log("You've succesfully logged into Google Keep!", opts.silent_mode)
                else:
                    fs.log("You've succesfully logged into Google Keep! " + 
                        "Your Keep access token has been securely stored in this computer's keyring.", opts.silent_mode)
        else:
            fs.log("You've succesfully logged into Google Keep using " + 
                            "local keyring access token!", opts.silent_mode)

        keep.resume()
        return keep
    except Exception as e:
        if isinstance(e, ValueError) and "non-interactive" in str(e):
            raise e
        raise ValueError("Username or password is incorrect") from e

def ui_query(keep, search_term, opts):
    try:
        if search_term != None:
            count = keep_query_convert(keep, search_term, opts)
            FileService.log("\nTotal converted notes: " + str(count), opts.silent_mode)
            return
        else:
            kquery = "kquery"
            while kquery:
                kquery = click.prompt("\r\nEnter a keyword search, label search or " + 
                    "'--all' to convert Keep notes to md or '--x' to exit", type=str)
                if kquery != "--x":
                    count = keep_query_convert(keep, kquery, opts)
                    FileService.log("\nTotal converted notes: " + str(count), opts.silent_mode)
                else:
                    return
    except Exception as e:
        raise Exception("Conversion to markdown error - " + repr(e) + " ")

def _validate_options(opts) -> None:
    VALID_PREFIXES = ("< ", "> ")
    r, o, a, p, s, c, l, j, m, w, d, q, i, lb, cd, ed  = opts

    if i and any([o, a, p, s, c, l, j, m, w, d]):
        raise click.UsageError("Import mode (-i) is not compatible " 
                                "with export options. Please use only "
                                "(-i) to import notes.")
    if lb and not i:
        raise click.UsageError("Import labels (-lb) can only be " 
                                "used with import mode (-i) in the "
                                "form (-i -lb my_label).")
    if o and s:
        raise click.UsageError("Overwrite(-o) and Skip(-s) flags " 
                                "are not compatible together "
                                "-- please use one or the other...")
    if a and m: 
        raise click.UsageError("Exporting archived notes (-a) and also moving " 
                                "them to archive (-m) is incompatible. " 
                                "-- please use export archive (-a) without (-m)")
    if cd and ed:
        raise click.UsageError("Filtering by both create date (-cd) and " 
                                "edit date (-ed) is not compatible.")
    date_filter_msg = "Date filter must be in the format '> YYYY-MM-DD' " \
                        "or '< YYYY-MM-DD' (e.g., '> 2023-01-15')."
    if cd:
        if not cd.startswith(VALID_PREFIXES): 
             raise click.BadParameter(date_filter_msg, param_hint='--cd')
        try:
            datetime.datetime.strptime(cd[2:], '%Y-%m-%d')
        except ValueError:
            raise click.BadParameter(
                f"Invalid date or date format for --cd. {date_filter_msg}", 
                                       param_hint='--cd')
    if ed:
        if not (ed.startswith(VALID_PREFIXES)): 
            raise click.BadParameter(date_filter_msg, param_hint='--ed')
        try:
            datetime.datetime.strptime(ed[2:], '%Y-%m-%d')
        except ValueError:
            raise click.BadParameter(
                f"Invalid date or date format for --ed. {date_filter_msg}", 
                                       param_hint='--ed')
    if i:
        FileService.log(
            "\r\nWARNING!!! Attempting to import many notes at once " + 
                "may risk Google Keep temporary account lockout. Use caution!", q)

    if m:
        FileService.log(
            "\r\nWARNING!!! Moving notes to archive will alter the " + 
                "edit dates of the archived notes. You cannot recover edit dates. Use caution!", q)

def _validate_paths() -> None:
    try:
        mp = Config().get("media_path")
        if ((":" in mp) or (mp[0] == '/')):
            raise ValueError(f"Media path: '{mp}' within your config file - " + 
                             f"{CONFIG_FILE} - must be relative to the output " + 
                             f"path and cannot start with / or a drive-mount")

        fs = FileService()
        fs.create_path(fs.outpath())
        fs.create_path(fs.media_path())
        fs.create_path(fs.inpath())
        fs.create_path(fs.inpath() + INPUTDEFAULTCOMPLETE)
    except Exception as e:
        raise PermissionError("Path creation error (invalid or read-only) - " \
                                "check paths in " + CONFIG_FILE + " - " + repr(e) + " ")

@click.command()
@click.option('-r', 'reset', is_flag=True, help="Will reset and not use the local keep access token in your system's keyring")
@click.option('-o', 'overwrite', is_flag=True, help="Overwrite any existing markdown files with the same name")
@click.option('-a', 'archive_only', is_flag=True, help="Search and export only archived notes")
@click.option('-p', 'preserve_labels', is_flag=True, help="Preserve keep labels with spaces and special characters")
@click.option('-s', 'skip_existing', is_flag=True, help="Skip over any existing notes with the same title")
@click.option('-c', 'text_for_title', is_flag=True, help="Use starting content within note body instead of create date for md filename")
@click.option('-l', 'logseq_style', is_flag=True, help="Prepend paragraphs with Logseq style bullets and preserve namespaces")
@click.option('-j', 'joplin_frontmatter', is_flag=True, help="Prepend notes with Joplin front matter tags and dates")
@click.option('-m', 'move_to_archive', is_flag=True, help="Move any exported Keep notes to Archive")
@click.option('-w', 'wikilinks', is_flag=True, help="Convert pre-formatted markdown note-to-note links to wikilinks")
@click.option('-d', 'delete_labels', is_flag=True, help="Remove any duplicate labels that are already embedded in a note as hashtags")
@click.option('-q', 'silent_mode', is_flag=True, help="Execute in silent mode - output in kim.log")
@click.option('-i', 'import_files', is_flag=True, help="Import notes from markdown files WARNING - EXPERIMENTAL!!")
@click.option('-lb', 'import_labels', '--lb', help="Labels for import - use only with (-i) flag")
@click.option('-cd', 'create_date', '--cd', help="Export notes before or after the create date - < or >|YYYY-MM-DD")
@click.option('-ed', 'edit_date', '--ed', help="Export notes before or after the edit date - < or >|YYYY-MM-DD")
@click.option('-b', '--search-term', help="Run in batch mode with a specific Keep search term")
@click.option('-t', '--master-token', help="Log in using master keep token")

def main( 
    reset: boolean,
    overwrite: boolean,
    archive_only: boolean,
    preserve_labels: boolean,
    skip_existing: boolean,
    text_for_title: boolean,
    logseq_style: boolean,
    joplin_frontmatter: boolean,
    move_to_archive: boolean,
    wikilinks: boolean,
    delete_labels: boolean,
    silent_mode: boolean,
    import_files: boolean,
    import_labels: str,
    create_date: str,
    edit_date: str,
    search_term: str,
    master_token: str
    ):

    if not master_token and os.environ.get("KIM_TOKEN"):
        master_token = os.environ.get("KIM_TOKEN")

    try:
        opts = Options(
            reset,
            overwrite,
            archive_only,
            preserve_labels,
            skip_existing,
            text_for_title,
            logseq_style,
            joplin_frontmatter,
            move_to_archive,
            wikilinks,
            delete_labels,
            silent_mode,
            import_files,
            import_labels,
            create_date,
            edit_date
        )

        _validate_options(astuple(opts))
        _validate_paths()

        keep = ui_login(master_token, opts)

        if import_files:
            keep_import_notes(keep, opts)
        else:
            ui_query(keep, search_term, opts)

    except Exception as e:
        print("Could not excute KIM - \nError: " + repr(e) + " ")
        import sys
        sys.exit(1)

if __name__ == '__main__':
    main()