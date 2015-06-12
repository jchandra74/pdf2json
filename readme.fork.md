This fork is an attempt to create a json that is more compatible with what is coming out in the TextLayer that is viewable in browser using pdfjs sample viewer at 75% zoom.

Since I am not concerned about images, lines, fills, etc.  I am only focusing on retrieving pages, text, bounding boxes, font and rotation info only.
The original Fill, Boxes, etc. are commented out from the final json output.

Original pdf2json has some magic constants that were applied and Form Unit conversion that have been reverted back.
for example:
	The scaling factor has been restored to 1 instead of the 1.5 that is in the original.
	The conversion of page width and height to form unit has been reverted back to whatever the viewport values are.
	
Some other changes:
	The Width: ... that is hanging around outside the page is now removed.  The width has been internalized for each page since it is possible to have different width and height per page in a pdf.

I am not concerned about saving bytes so removing the reference tables and instead I'm inlining the information such as font name, boldness, italic, size, etc. directly into each text elements.
